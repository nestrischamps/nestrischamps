import { GpuTetrisOCR } from '../gpuTetrisOCR.js';
import { PATTERN_MAX_INDEXES, GYM_PAUSE_LUMA_THRESHOLD } from '../constants.js';
import { findMinIndex, u32ToRgba } from '/ocr/utils.js';
import { OcrCompute } from './ocrCompute.js';

async function getGPU() {
	const adapter = await navigator.gpu.requestAdapter({
		powerPreference: 'high-performance',
	});
	const device = await adapter.requestDevice();
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

	const [vertex, fragment, compute] = await Promise.all([
		GpuTetrisOCR.loadShaderSource('/producer/webgpu/shaders/vertex.wgsl'),
		GpuTetrisOCR.loadShaderSource('/producer/webgpu/shaders/fragment.wgsl'),
		GpuTetrisOCR.loadShaderSource('/producer/webgpu/shaders/compute.wgsl'),
	]);

	return {
		adapter,
		device,
		canvasFormat,

		shaders: {
			vertex: device.createShaderModule({
				code: vertex,
			}),
			fragment: device.createShaderModule({
				code: fragment,
			}),
			compute: device.createShaderModule({
				code: compute,
			}),
		},
	};
}

let getGpuPromise;

function lazyGetGPU() {
	if (!getGpuPromise) {
		getGpuPromise = getGPU(); // no await!
	}

	return getGpuPromise;
}

export class WGpuTetrisOCR extends GpuTetrisOCR {
	#gpu = null;
	#ready = false;

	#renderBindGroupLayoutGlobals;
	#renderBindGroupLayoutRegion;
	#globalsBuffer;
	#globalsBindGroup;

	constructor(config) {
		super(config);

		Promise.all([this.#getGPU(), this.loadDigitTemplates()]).then(() => {
			this.#initGpuAssets();
			this.#ready = true;
		});
	}

	async #getGPU() {
		this.#gpu = await lazyGetGPU(); // shares the gpu and shaders across all instances
	}

	setConfig(config) {
		super.setConfig(config);
	}

	updateScore67Config() {
		this.#prepGpuComputeDigitAssets();
	}

	#initGpuRenderAssets() {
		const { device, canvasFormat, shaders } = this.#gpu;

		this.output_ctx = this.output_canvas.getContext('webgpu');
		this.output_ctx.configure({
			device: device,
			format: canvasFormat,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		});

		this.atlas_txt = device.createTexture({
			size: [this.output_canvas.width, this.output_canvas.height],
			format: canvasFormat,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.COPY_DST,
		});
		this.atlas_txt_view = this.atlas_txt.createView();

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
				module: shaders.vertex,
				entryPoint: 'main',
				buffers: [], // No vertex buffers are needed as positions are hardcoded in the shader
			},
			fragment: {
				module: shaders.fragment,
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

	#fillRegionBuffers() {
		const { device } = this.#gpu;

		for (const task of Object.values(this.config.tasks)) {
			// Get the transform type from task configuration
			const transformType = task.luma
				? GpuTetrisOCR.TRANSFORM_TYPES.LUMA
				: task.red_luma
					? GpuTetrisOCR.TRANSFORM_TYPES.RED_LUMA
					: GpuTetrisOCR.TRANSFORM_TYPES.NONE;

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
		}
	}

	#prepGpuComputeDigitAssets() {
		// run this one to update all the buffers (only needed for score but whatever)
		this.#fillRegionBuffers();

		const digitSize = 14;
		const digitSizeWBorder = 16;
		const jobs = [];

		this.digitFields = this.configData.fields
			.filter(name => this.config.tasks[name].pattern)
			.map(name => ({ name, task: this.config.tasks[name] }));

		// prepare all jobs
		this.digitFields.forEach(({ task }) => {
			const { x, y } = task.packing_pos;

			task.patternJobs = [];
			task.pattern.split('').forEach((pid, pidx) => {
				const maxIndex = PATTERN_MAX_INDEXES[pid] || 1;
				const digitJobs = [];

				for (let refIndex = 0; refIndex < maxIndex; refIndex++) {
					const job = {
						x: x + digitSizeWBorder * pidx,
						y,
						refIndex,
					};
					digitJobs.push(job);
					jobs.push(job);
				}

				task.patternJobs.push(digitJobs);
			});
		});

		this.ocrCompute.prepMatchDigitsGPUAssets({
			texWidth: this.output_canvas.width,
			texHeight: this.output_canvas.height,
			digitSize,
			refDigits: this.digit_lumas_f32,
			numRefs: 16, // maximum 16 reference digits to compare against
			jobs,
		});
	}

	#prepGpuComputeNonDigitAssets() {
		this.nonDigitFields = this.configData.fields
			.filter(name => !this.config.tasks[name].pattern)
			.map(name => ({ name, task: this.config.tasks[name] }));

		const boardPackingPos = this.config.tasks.field.packing_pos;
		const blockSize = 8;
		const boardBlockPositions = new Array(200).fill(0).map((_, idx) => {
			const col = idx % 10;
			const row = Math.floor(idx / 10);
			return {
				x: boardPackingPos.x + col * blockSize,
				y: boardPackingPos.y + row * blockSize,
			};
		});

		// Provide 3 reference block top-left positions
		const refColorPositions = this.config.tasks.color1
			? [
					this.config.tasks.color1.packing_pos,
					this.config.tasks.color2.packing_pos,
					this.config.tasks.color3.packing_pos,
				]
			: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
				];

		// Provide shine-only top-left positions for preview blocks
		const previewPos = this.config.tasks.preview.packing_pos;

		// TODO: move these offsets to constants and reuse in both cpu and gpu OCR classes

		const shinePositions = [
			...GpuTetrisOCR.previewBlockPositions.map(xy => ({
				x: xy[0] + previewPos.x,
				y: xy[1] + previewPos.y,
			})),
		];

		if (this.config.tasks.cur_piece) {
			const curPiecePos = this.config.tasks.cur_piece.packing_pos;
			shinePositions.push(
				...GpuTetrisOCR.curPieceBlockPositions.map(xy => ({
					x: xy[0] + curPiecePos.x,
					y: xy[1] + curPiecePos.y,
				}))
			);
		}

		this.ocrCompute.prepMatchNonDigitsGPUAssets({
			texWidth: this.output_canvas.width,
			texHeight: this.output_canvas.height,
			threshold255: GpuTetrisOCR.lumaThreshold255,
			boardBlockPositions,
			refColorPositions,
			shinePositions,
		});
	}

	#initGpuComputeAssets() {
		const { device, shaders } = this.#gpu;
		this.ocrCompute = new OcrCompute(device, shaders.compute);

		this.#prepGpuComputeDigitAssets();
		this.#prepGpuComputeNonDigitAssets();
	}

	#initGpuAssets(frame) {
		this.#initGpuRenderAssets(frame);
		this.#initGpuComputeAssets(frame);
	}

	renderExtractedRegions({ videoFrame, video }) {
		const { device } = this.#gpu;

		// assign to instance to ensure it is not garbage collected
		this.inputTexture = this.#gpu.device.importExternalTexture({
			source: videoFrame || video,
		});

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
					resource: device.createSampler({
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

		const commandEncoder = device.createCommandEncoder();

		// --- Render all regions to the main output canvas ---
		const mainPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.atlas_txt_view,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: [0.2, 0.2, 0.2, 1.0],
				},
			],
		});

		mainPass.setPipeline(this.renderPipelineToOutputTexture);

		// Set the main "global" bind group at index 0.
		mainPass.setBindGroup(0, this.#globalsBindGroup);

		// Loop through each task and draw its region
		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// Set the per-task bind group and draw.
			mainPass.setBindGroup(1, task.regionBindGroup);
			mainPass.draw(6, 1, 0);
		});

		mainPass.end();

		if (this.config.show_capture_ui) {
			commandEncoder.copyTextureToTexture(
				{ texture: this.atlas_txt },
				{ texture: this.output_ctx.getCurrentTexture() },
				[this.output_canvas.width, this.output_canvas.height]
			);
		}

		device.queue.submit([commandEncoder.finish()]);
	}

	// this function OCRs ALL digits in one job, and then aggregate the results into a meaning structure
	async doDigitOCR() {
		performance.mark(`start-doDigitOCR-${this.perfSuffix}`);
		// run on gpu
		const sse = await this.ocrCompute.matchDigits({
			inputTexture: this.atlas_txt,
		});

		// process result (find minima matches)
		const res = {};
		let curSseIdx = 0;

		this.digitFields.forEach(({ name, task }) => {
			const matches = task.patternJobs.map(digitJobs => {
				const lumaSses = sse.subarray(curSseIdx, curSseIdx + digitJobs.length);
				const indexMatch = findMinIndex(lumaSses);

				curSseIdx += digitJobs.length;

				return indexMatch ? indexMatch - 1 : null;
			});

			res[name] = matches.some(v => v === null) ? null : matches;
		});

		performance.mark(`end-doDigitOCR-${this.perfSuffix}`);
		performance.measure(
			`doDigitOCR-${this.perfSuffix}`,
			`start-doDigitOCR-${this.perfSuffix}`,
			`end-doDigitOCR-${this.perfSuffix}`
		);

		return res;
	}

	async doNonDigitOCR() {
		performance.mark(`start-doNonDigitOCR-${this.perfSuffix}`);

		// run on gpu
		const { boardColors, refColors, shines, gymPauseF32 } =
			await this.ocrCompute.analyzeBoard({
				inputTexture: this.atlas_txt,
			});

		const gymPauseLuma255 = gymPauseF32 * 255;

		const res = {
			field: boardColors, // includes shine in alpha channel
			preview: GpuTetrisOCR.getPreviewFromShines(shines.subarray(0, 14)),
		};

		if (this.config.tasks.color1) {
			res.color1 = u32ToRgba(refColors[0]);
			res.color2 = u32ToRgba(refColors[1]);
			res.color3 = u32ToRgba(refColors[2]);
		}

		if (this.config.tasks.cur_piece) {
			res.cur_piece = GpuTetrisOCR.getCurPieceFromShines(shines.subarray(14));
			res.gym_pause = [0, false];
		} else {
			res.gym_pause = [
				Math.round(gymPauseLuma255),
				gymPauseLuma255 > GYM_PAUSE_LUMA_THRESHOLD,
			];
		}

		performance.mark(`end-doNonDigitOCR-${this.perfSuffix}`);
		performance.measure(
			`doNonDigitOCR-${this.perfSuffix}`,
			`start-doNonDigitOCR-${this.perfSuffix}`,
			`end-doNonDigitOCR-${this.perfSuffix}`
		);

		return res;
	}

	async processVideoFrame(frame) {
		if (!this.#ready) return;

		super.processVideoFrame(frame);

		performance.mark(`start-processVideoFrame-${this.perfSuffix}`);

		if (this.config.show_capture_ui) {
			this.extractAndHighlightRegions(frame);
		}
		this.renderExtractedRegions(frame);

		const [digitRes, nonDigitRes] = await Promise.all([
			this.doDigitOCR(),
			this.doNonDigitOCR(),
		]);

		performance.mark(`end-processVideoFrame-${this.perfSuffix}`);
		performance.measure(
			`processVideoFrame-${this.perfSuffix}`,
			`start-processVideoFrame-${this.perfSuffix}`,
			`end-processVideoFrame-${this.perfSuffix}`
		);

		const event = new CustomEvent('frame', {
			detail: { ...digitRes, ...nonDigitRes },
		});
		this.dispatchEvent(event);
	}
}
