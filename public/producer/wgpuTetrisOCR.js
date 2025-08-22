import { TetrisOCR } from './TetrisOCR.js';
import { crop, luma } from '/ocr/image_tools.js';
import {
	PATTERN_MAX_INDEXES,
	SHINE_LUMA_THRESHOLD,
	GYM_PAUSE_CROP_RELATIVE_TO_FIELD,
	GYM_PAUSE_LUMA_THRESHOLD,
} from './constants.js';
import { clamp, timingDecorator } from '/ocr/utils.js';

const TRANSFORM_TYPES = {
	NONE: 0,
	LUMA: 1,
	RED_LUMA: 2,
};

const PERF_METHODS = [
	'scanScore',
	'scanLevel',
	'scanLines',
	'scanColor1',
	'scanColor2',
	'scanColor3',
	'scanPreview',
	'scanField',
	'scanPieceStats',

	'scanInstantDas',
	'scanCurPieceDas',
	'scanCurPiece',
	'scanGymPause',

	'extractAndHighlightRegions',
	'processVideoFrame',
	'renderExtractedRegions',
];

async function loadShaderSource(url) {
	return await fetch(url).then(res => res.text());
}

let perfSuffix = 0;

export class WGpuTetrisOCR extends TetrisOCR {
	#ready = false;
	#shaders;

	#renderBindGroupLayoutGlobals;
	#renderBindGroupLayoutRegion;
	#globalsBuffer;
	#globalsBindGroup;

	constructor(config) {
		super(config);

		this.perfSuffix = ++perfSuffix;

		this.digit_img = new ImageData(14, 14);
		this.shine_img = new ImageData(2, 3);

		// decorate relevant methods to capture timings
		PERF_METHODS.forEach(name => {
			const method = this[name].bind(this);
			this[name] = timingDecorator(`${name}-${this.perfSuffix}`, method);
		});

		this.#loadShaders();
	}

	async #loadShaders() {
		const [vertex, fragment, compute] = await Promise.all([
			loadShaderSource('/producer/shaders/vertex.wgsl'),
			loadShaderSource('/producer/shaders/fragment.wgsl'),
			loadShaderSource('/producer/shaders/compute.wgsl'),
		]);

		this.#shaders = {
			vertex,
			fragment,
			compute,
		};

		this.#ready = true;
	}

	setConfig(config) {
		super.setConfig(config);
	}

	#initGpuAssets({ video, gpu }) {
		const { device, canvasFormat } = gpu;

		this.capture_canvas._ntc_initialized = true;
		this.capture_canvas.width = video.videoWidth;
		this.capture_canvas.height =
			video.videoHeight >> (this.config.use_half_height ? 1 : 0);

		this.capture_ctx = this.capture_canvas.getContext('2d');
		this.capture_ctx.imageSmoothingEnabled = false;

		this.output_ctx = this.output_canvas.getContext('webgpu');
		this.output_ctx.configure({
			device: gpu.device,
			format: gpu.canvasFormat,
			alphaMode: 'opaque',
		});

		const vertexModule = device.createShaderModule({
			code: this.#shaders.vertex,
		});
		const fragmentModule = device.createShaderModule({
			code: this.#shaders.fragment,
		});

		// Layout for Globals (Group 0) - used in both vertex and fragment shaders
		// It has a uniform buffer at binding 0, a sampler at binding 1, and a texture at binding 2.
		// This layout matches the `@group(0)` definitions in fragment.wgsl.
		this.#renderBindGroupLayoutGlobals = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform' },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: {},
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					externalTexture: {},
				},
			],
		});

		// Layout for Region (Group 1) - used in both vertex and fragment shaders
		// It has a uniform buffer at binding 0.
		// This layout matches the `@group(1)` definitions in both shaders.
		this.#renderBindGroupLayoutRegion = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform' },
				},
			],
		});

		this.renderPipelineToOutputTexture = device.createRenderPipeline({
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					this.#renderBindGroupLayoutGlobals,
					this.#renderBindGroupLayoutRegion,
				],
			}),
			vertex: {
				module: vertexModule,
				entryPoint: 'main',
				buffers: [], // No vertex buffers are needed as positions are hardcoded in the shader
			},
			fragment: {
				module: fragmentModule,
				entryPoint: 'main',
				targets: [{ format: canvasFormat }],
			},
			primitive: {
				topology: 'triangle-list',
			},
		});

		// Create the globals buffer (since it's a new uniform)
		// It holds the outputSize and inputSize, which are used by the shaders.
		// The size is 2x vec2<f32> = 4x f32 = 16 bytes, but let's use 32 for padding
		this.#globalsBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		for (const task of Object.values(this.config.tasks)) {
			task.canvas_ctx = task.canvas.getContext('2d', { alpha: false });

			task.regionBuffer = device.createBuffer({
				size: 48, // 9xf32 + padding
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});

			task.regionBindGroup = device.createBindGroup({
				layout: this.#renderBindGroupLayoutRegion,
				entries: [{ binding: 0, resource: { buffer: task.regionBuffer } }],
			});
		}
	}

	renderExtractedRegions({ video, gpu }) {
		const { device } = gpu;

		// Update the globals buffer with current sizes
		const globalsData = new Float32Array([
			this.output_canvas.width, // outputSize
			this.output_canvas.height,
			video.videoWidth, // inputSize
			video.videoHeight,
			this.config.brightness, // color corrections
			this.config.contrast,
		]);
		// console.log([
		// 	this.config.brightness,
		// 	typeof this.config.brightness,
		// 	this.config.contrast,
		// 	typeof this.config.contrast,
		// ]); // outpus [1, 1] as expected
		device.queue.writeBuffer(this.#globalsBuffer, 0, globalsData);

		// Create the main bind group for the global uniforms and texture.
		// This now correctly bundles globals, inputSampler, and inputTexture
		// into a single bind group that matches @group(0) in the fragment shader.
		this.#globalsBindGroup = device.createBindGroup({
			layout: this.#renderBindGroupLayoutGlobals,
			entries: [
				{
					binding: 0,
					resource: {
						buffer: this.#globalsBuffer,
					},
				},
				{
					binding: 1,
					resource: gpu.device.createSampler({
						magFilter: 'linear',
						minFilter: 'linear',
						addressModeU: 'clamp-to-edge',
						addressModeV: 'clamp-to-edge',
					}),
				},
				{
					binding: 2,
					resource: this.inputTexture,
				},
			],
		});

		const commandEncoder = gpu.device.createCommandEncoder();

		// --- Render all regions to the main output canvas ---
		const mainPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.output_ctx.getCurrentTexture().createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: [0.0, 0.0, 0.0, 1.0],
				},
			],
		});

		mainPass.setPipeline(this.renderPipelineToOutputTexture);

		// Set the main "global" bind group at index 0.
		mainPass.setBindGroup(0, this.#globalsBindGroup);

		// Loop through each task and draw its region
		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// Get the transform type from task configuration
			const transformType = task.luma
				? TRANSFORM_TYPES.LUMA
				: task.red_luma
					? TRANSFORM_TYPES.RED_LUMA
					: TRANSFORM_TYPES.NONE;

			// Create the data for the uniform buffer
			const regionData = new Float32Array([
				task.crop.x, // TODO: need to update buffer when crop changes!
				task.crop.y,
				task.crop.w,
				task.crop.h,
				task.packing_pos.x,
				task.packing_pos.y,
				task.canvas.width,
				task.canvas.height,
				transformType,
				0.0,
				0.0,
				0.0, // Padding for vec4<f32> alignment
			]);

			// Write the new data to the buffer.
			device.queue.writeBuffer(task.regionBuffer, 0, regionData);

			// Set the per-task bind group and draw.
			mainPass.setBindGroup(1, task.regionBindGroup);
			mainPass.draw(6, 1, 0);
		});

		mainPass.end();

		device.queue.submit([commandEncoder.finish()]);
	}

	#getCanvasFilters() {
		const filters = [];

		if (this.config.brightness > 1) {
			filters.push(`brightness(${this.config.brightness})`);
		}

		if (this.config.contrast !== 1) {
			filters.push(`contrast(${this.config.contrast})`);
		}

		return filters.length ? filters.join(' ') : 'none';
	}

	extractAndHighlightRegions(frame) {
		const { videoFrame, video } = frame;

		// --- 2D Canvas Drawing (Original Video + Highlights) ---
		this.capture_ctx.filter = this.#getCanvasFilters();
		this.capture_ctx.drawImage(
			videoFrame || video,
			0,
			0,
			this.capture_canvas.width,
			this.capture_canvas.height
		);

		this.capture_ctx.fillStyle = '#FFA50080'; // Transparent orange
		for (const name in this.config.tasks) {
			const task = this.config.tasks[name];

			task.canvas_ctx.drawImage(
				this.capture_canvas,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h,
				0,
				0,
				task.canvas.width,
				task.canvas.height
			);

			this.capture_ctx.fillRect(
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
		}
	}

	async processVideoFrame(frame) {
		if (!this.#ready) return;

		const { gpu, videoFrame, video, digit_lumas } = frame;

		// dirty lazy init actions?
		if (!this.digit_lumas) this.digit_lumas = digit_lumas;
		if (!this.capture_canvas._ntc_initialized) {
			this.#initGpuAssets(frame);
		}

		this.extractAndHighlightRegions(frame);

		performance.mark(`start-${this.perfSuffix}`);

		this.inputTexture = gpu.device.importExternalTexture({
			source: videoFrame || video,
		});

		performance.mark(`gpu-end-${this.perfSuffix}`);

		performance.measure(
			`gpu-copy-to-input-texture-${this.perfSuffix}`,
			`start-${this.perfSuffix}`,
			`gpu-end-${this.perfSuffix}`
		);

		this.renderExtractedRegions(frame);

		await gpu.device.queue.onSubmittedWorkDone();

		// const event = new CustomEvent('frame', {
		// 	detail: {},
		// });
		// this.dispatchEvent(event);
	}

	getDigit(pixel_data, max_check_index, is_red) {
		const sums = new Float64Array(max_check_index);
		const size = pixel_data.length >>> 2;

		for (let p_idx = size; p_idx--; ) {
			const offset_idx = p_idx << 2;
			let pixel_luma;

			if (is_red) {
				const contrastHigh = 128;
				const contrastLow = 20;
				const contrastedCorrectedRedRatio =
					(pixel_data[offset_idx] - contrastLow) / (contrastHigh - contrastLow);
				pixel_luma = clamp(255 * contrastedCorrectedRedRatio, 0, 255);
			} else {
				pixel_luma = luma(
					pixel_data[offset_idx],
					pixel_data[offset_idx + 1],
					pixel_data[offset_idx + 2]
				);
			}

			for (let t_idx = max_check_index; t_idx--; ) {
				const diff = pixel_luma - this.digit_lumas[t_idx][p_idx];
				sums[t_idx] += diff * diff;
			}
		}

		let min_val = 0xffffffff;
		let min_idx = -1;

		for (let s_idx = sums.length; s_idx--; ) {
			if (sums[s_idx] < min_val) {
				min_val = sums[s_idx];
				min_idx = s_idx;
			}
		}

		return min_idx;
	}

	ocrDigits(source_img, task) {
		const digits = Array(task.pattern.length);
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		for (let idx = digits.length; idx--; ) {
			const char = task.pattern[idx];

			crop(img, idx * 16, 0, 14, 14, this.digit_img);

			const digit = this.getDigit(
				this.digit_img.data,
				PATTERN_MAX_INDEXES[char],
				task.red_luma
			);

			if (!digit) return null;

			digits[idx] = digit - 1;
		}

		return digits;
	}

	hasShine(img, block_x, block_y) {
		// extract the shine area at the location supplied
		const shine_width = 2;
		crop(img, block_x, block_y, shine_width, 3, this.shine_img);

		const img_data = this.shine_img.data;
		const shine_pix_ref = [
			[0, 0],
			[1, 1],
			[1, 2],
		];

		return shine_pix_ref.some(([x, y]) => {
			const offset_idx = (y * shine_width + x) << 2;
			const pixel_luma = luma(
				img_data[offset_idx],
				img_data[offset_idx + 1],
				img_data[offset_idx + 2]
			);

			return pixel_luma > SHINE_LUMA_THRESHOLD;
		});
	}

	scanScore(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.score);
	}

	scanLevel(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.level);
	}

	scanLines(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.lines);
	}

	scanColor2(source_img) {
		return this.scanColor(source_img, this.config.tasks.color2);
	}

	scanColor3(source_img) {
		return this.scanColor(source_img, this.config.tasks.color3);
	}

	scanInstantDas(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.instant_das);
	}

	scanCurPieceDas(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.cur_piece_das);
	}

	scanPieceStats(source_img) {
		return {
			T: this.ocrDigits(source_img, this.config.tasks.T),
			J: this.ocrDigits(source_img, this.config.tasks.J),
			Z: this.ocrDigits(source_img, this.config.tasks.Z),
			O: this.ocrDigits(source_img, this.config.tasks.O),
			S: this.ocrDigits(source_img, this.config.tasks.S),
			L: this.ocrDigits(source_img, this.config.tasks.L),
			I: this.ocrDigits(source_img, this.config.tasks.I),
		};
	}

	scanPreview(source_img) {
		const task = this.config.tasks.preview;
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		// Trying side i blocks
		if (
			this.hasShine(img, 0, 4) &&
			this.hasShine(img, 28, 4) // not top-left corner, but since I block are white, should work
		) {
			return 'I';
		}

		// now trying the 3x2 matrix for T, L, J, S, Z
		const top_row = [
			this.hasShine(img, 4, 0),
			this.hasShine(img, 12, 0),
			this.hasShine(img, 20, 0),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			// J, T, L
			if (this.hasShine(img, 4, 8)) {
				return 'L';
			}
			if (this.hasShine(img, 12, 8)) {
				return 'T';
			}
			if (this.hasShine(img, 20, 8)) {
				return 'J';
			}

			return null;
		}

		if (top_row[1] && top_row[2]) {
			if (this.hasShine(img, 4, 8) && this.hasShine(img, 12, 8)) {
				return 'S';
			}
		}

		if (top_row[0] && top_row[1]) {
			if (this.hasShine(img, 12, 8) && this.hasShine(img, 20, 8)) {
				return 'Z';
			}
		}

		// lastly check for O
		if (
			this.hasShine(img, 8, 0) &&
			this.hasShine(img, 16, 0) &&
			this.hasShine(img, 8, 8) &&
			this.hasShine(img, 16, 8)
		) {
			return 'O';
		}

		return null;
	}

	scanCurPiece(source_img) {
		const task = this.config.tasks.cur_piece;
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		// Trying side i blocks
		if (this.hasShine(img, 0, 4) && this.hasShine(img, 20, 4)) {
			return 'I';
		}

		// now trying for L, J (top pixel alignment)
		let top_row = [
			this.hasShine(img, 2, 0),
			this.hasShine(img, 8, 0),
			this.hasShine(img, 14, 0),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			if (this.hasShine(img, 2, 6)) {
				return 'L';
			}
			if (this.hasShine(img, 14, 6)) {
				return 'J';
			}
		}

		// checking S, Z, T
		top_row = [
			this.hasShine(img, 2, 1),
			this.hasShine(img, 8, 1),
			this.hasShine(img, 14, 1),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			if (this.hasShine(img, 8, 7)) {
				return 'T';
			}

			return null;
		}

		if (top_row[1] && top_row[2]) {
			if (this.hasShine(img, 2, 7) && this.hasShine(img, 8, 7)) {
				return 'S';
			}
		}

		if (top_row[0] && top_row[1]) {
			if (this.hasShine(img, 8, 7) && this.hasShine(img, 14, 7)) {
				return 'Z';
			}
		}

		// lastly check for O
		if (
			this.hasShine(img, 5, 1) &&
			this.hasShine(img, 11, 1) &&
			this.hasShine(img, 5, 7) &&
			this.hasShine(img, 11, 7)
		) {
			return 'O';
		}

		return null;
	}

	scanColor1(source_img) {
		const task = this.config.tasks.color1;
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		// I tried selecting the pixel with highest luma but that didn't work.
		// On capture cards with heavy color bleeding, it's inaccurate.

		// we select the brightest pixel in the center 3x3 square of the
		const row_width = img.width;

		let composite_white = [0, 0, 0];

		// we check luma pixels on the inside only
		for (let y = img.height - 1; --y; ) {
			for (let x = img.width - 1; --x; ) {
				const pix_offset = (y * row_width + x) << 2;
				const cur_color = img.data.subarray(pix_offset, pix_offset + 3);

				composite_white[0] = Math.max(composite_white[0], cur_color[0]);
				composite_white[1] = Math.max(composite_white[1], cur_color[1]);
				composite_white[2] = Math.max(composite_white[2], cur_color[2]);
			}
		}

		return composite_white;

		/*
	// possible alternative:
	// compute color average for pixel references
	[[1, 3], [2, 2], [3, 1], [3, 3]]
	OR
	[[1, 2], [2, 2], [3, 2], [3, 1], [3, 3]]
	/**/
	}

	scanColor(source_img, task) {
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		const row_width = img.width;
		const pix_refs = [
			[3, 2],
			[3, 3],
			[2, 3],
		];

		return pix_refs
			.map(([x, y]) => {
				const col_idx = (y * row_width + x) << 2;
				return img.data.subarray(col_idx, col_idx + 3);
			})
			.reduce(
				(acc, col) => {
					acc[0] += col[0] * col[0];
					acc[1] += col[1] * col[1];
					acc[2] += col[2] * col[2];
					return acc;
				},
				[0, 0, 0]
			)
			.map(v => Math.sqrt(v / pix_refs.length));
	}

	scanGymPause(source_img) {
		// Scanning the pause text scans the bottom of the letter 'U', "S", and "E" of the text "PAUSE"
		// that's because the bottom of the letters overlaps with block margins, which are black
		// When the pause text is not visible, luma on these overlap is expected to be very low
		// When pause text is visible, luma is expected to be high.
		const field_task = this.config.tasks.field;
		const img = crop(
			source_img,
			field_task.packing_pos.x + GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x,
			field_task.packing_pos.y + GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y,
			GYM_PAUSE_CROP_RELATIVE_TO_FIELD.w,
			GYM_PAUSE_CROP_RELATIVE_TO_FIELD.h
			// TODO: there's no gym_pause task, but can we still have a reusable gym_pause img?
		);

		const pix_refs = [
			// 1 pixel for U
			[2, 0],

			// 1 pixel for S
			[10, 0],

			// 2 pixels for E
			[17, 0],
			[18, 0],
		];

		const total_luma = pix_refs
			.map(([x, y]) => {
				const col_idx = x << 2;
				return luma(...img.data.subarray(col_idx, col_idx + 3));
			})
			.reduce((acc, luma) => acc + luma, 0);

		const avg_luma = total_luma / pix_refs.length;

		return [Math.round(avg_luma), avg_luma > GYM_PAUSE_LUMA_THRESHOLD];
	}

	scanField(source_img) {
		// Note: We work in the square of colors domain
		// see: https://www.youtube.com/watch?v=LKnqECcg6Gw
		const task = this.config.tasks.field;
		const img = crop(
			source_img,
			task.packing_pos.x,
			task.packing_pos.y,
			task.canvas.width,
			task.canvas.height,
			task.img
		);

		// Make a memory efficient array for our needs
		const field = {
			shines: new Uint8Array(200),
			colors: new Uint32Array(200),
		};

		// shine pixels
		const shine_pix_refs = [
			[1, 1],
			[1, 2],
			[2, 1],
		];

		// we read 4 judiciously positionned logical pixels per block
		const pix_refs = [
			[2, 4],
			[3, 3],
			[4, 4],
			[4, 2],
		];

		const row_width = 9 * 8 + 7; // the last block in a row is one pixel less!

		for (let ridx = 0; ridx < 20; ridx++) {
			for (let cidx = 0; cidx < 10; cidx++) {
				const block_offset = (ridx * row_width * 8 + cidx * 8) * 4;
				const block_idx = ridx * 10 + cidx;

				const has_shine = shine_pix_refs.some(([x, y]) => {
					const col_idx = block_offset + y * row_width * 4 + x * 4;
					const col = img.data.subarray(col_idx, col_idx + 3);

					return luma(...col) > SHINE_LUMA_THRESHOLD;
				});

				field.shines[block_idx] = has_shine ? 1 : 0;

				if (!has_shine) {
					field.colors[block_idx] = 0; // we have black for sure! no ned to compute colors from reference pixels
					continue;
				}

				const channels = pix_refs
					.map(([x, y]) => {
						const col_idx = block_offset + y * row_width * 4 + x * 4;
						return img.data.subarray(col_idx, col_idx + 3);
					})
					.reduce(
						(acc, col) => {
							acc[0] += col[0] * col[0];
							acc[1] += col[1] * col[1];
							acc[2] += col[2] * col[2];
							return acc;
						},
						[0, 0, 0]
					)
					.map(v => Math.sqrt(v / pix_refs.length));

				field.colors[block_idx] =
					(channels[0] << 24) | (channels[1] << 16) | (channels[2] << 8) | 0xff; // ff for fully opaque
			}
		}

		return field;
	}
}
