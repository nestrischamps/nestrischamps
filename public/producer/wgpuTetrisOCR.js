import { TetrisOCR } from './TetrisOCR.js';
import { crop, luma } from '/ocr/image_tools.js';
import {
	PATTERN_MAX_INDEXES,
	SHINE_LUMA_THRESHOLD,
	GYM_PAUSE_CROP_RELATIVE_TO_FIELD,
	GYM_PAUSE_LUMA_THRESHOLD,
} from './constants.js';
import { clamp, findMinIndex, timingDecorator } from '/ocr/utils.js';
import { OcrCompute } from './ocrCompute.js';

const TRANSFORM_TYPES = {
	NONE: 0,
	LUMA: 1,
	RED_LUMA: 2,
};

async function loadShaderSource(url) {
	return await fetch(url).then(res => res.text());
}

export class WGpuTetrisOCR extends TetrisOCR {
	#gpu = null;
	#ready = false;
	#shaders;

	#renderBindGroupLayoutGlobals;
	#renderBindGroupLayoutRegion;
	#globalsBuffer;
	#globalsBindGroup;

	constructor(config) {
		super(config);

		this.#gpu = this.#getGPU();

		this.instrument(
			'extractAndHighlightRegions',
			'processVideoFrame',
			'renderExtractedRegions',
			'doDigitOCR'
		);

		Promise.all([
			this.#getGPU(),
			this.#loadShaders(),
			this.loadDigitTemplates(),
		]).then(() => {
			this.#initGpuAssets();
			this.#ready = true;
		});
	}

	async loadDigitTemplates() {
		const digit_lumas = await TetrisOCR.loadDigitTemplates();

		this.digit_lumas_f32 = new Float32Array(
			digit_lumas.flatMap(typedArr => Array.from(typedArr)).map(v => v / 255)
		);
	}

	async #getGPU() {
		const adapter = await navigator.gpu.requestAdapter();
		const device = await adapter.requestDevice();
		const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

		this.#gpu = {
			adapter,
			device,
			canvasFormat,
		};
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
	}

	setConfig(config) {
		super.setConfig(config);
	}

	#initGpuRenderAssets() {
		const { device, canvasFormat } = this.#gpu;

		this.output_ctx = this.output_canvas.getContext('webgpu');
		this.output_ctx.configure({
			device: device,
			format: canvasFormat,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		});

		this.temp_output_txt = device.createTexture({
			size: [this.output_canvas.width, this.output_canvas.height],
			format: canvasFormat,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.COPY_DST,
		});
		this.temp_output_txt_view = this.temp_output_txt.createView();

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

	#initGpuComputeAssets() {
		const { device } = this.#gpu;
		this.ocrCompute = new OcrCompute(device, this.#shaders.compute);

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
					view: this.temp_output_txt_view,
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

		commandEncoder.copyTextureToTexture(
			{ texture: this.temp_output_txt },
			{ texture: this.output_ctx.getCurrentTexture() },
			[this.output_canvas.width, this.output_canvas.height]
		);

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

		if (!this.capture_canvas._ntc_initialized) {
			this.capture_canvas._ntc_initialized = true;
			this.capture_canvas.width = video.videoWidth;
			this.capture_canvas.height =
				video.videoHeight >> (this.config.use_half_height ? 1 : 0);

			this.capture_ctx = this.capture_canvas.getContext('2d', { alpha: false });
			this.capture_ctx.imageSmoothingEnabled = false;
		}

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

	// this function OCRs ALL digits in one job, and then aggregate the results into a meaning structure
	async doDigitOCR(frame) {
		// run on gpu
		const sse = await this.ocrCompute.matchDigits({
			inputTexture: this.temp_output_txt,
		});

		// process result (find minima matches)
		const res = {};
		let curSseIdx = 0;

		this.digitFields.forEach(({ name, task }) => {
			res[name] = task.patternJobs.map(digitJobs => {
				const lumaSses = sse.subarray(curSseIdx, curSseIdx + digitJobs.length);
				const indexMatch = findMinIndex(lumaSses);

				curSseIdx += digitJobs.length;

				return indexMatch ? indexMatch - 1 : null;
			});
		});

		return res;
	}

	async processVideoFrame(frame) {
		if (!this.#ready) return;

		this.extractAndHighlightRegions(frame);
		this.renderExtractedRegions(frame);

		await this.#gpu.device.queue.onSubmittedWorkDone(); // is this needed?

		const digitRes = await this.doDigitOCR(frame);

		const event = new CustomEvent('frame', {
			detail: digitRes,
		});
		this.dispatchEvent(event);
	}
}
