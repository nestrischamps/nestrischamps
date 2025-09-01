// ============================================
// WebGPU OCR Compute – Javascript host code
// ============================================

let perfSuffix = 0;

export class OcrCompute {
	device;

	// Pipelines
	matchPipeline;
	boardPipeline;

	constructor(device, computeShaderModule) {
		this.perfSuffix = ++perfSuffix;
		this.device = device;

		// Pipeline 1: match_digits
		const matchLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: 'unfilterable-float' },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'uniform' },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' },
				},
			],
		});

		this.matchPipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [matchLayout] }),
			compute: { module: computeShaderModule, entryPoint: 'match_digits' },
		});

		// Pipeline 2: analyze_everything
		const boardLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: 'unfilterable-float' },
				},
				{
					binding: 1, // globals
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'uniform' },
				},
				{
					binding: 2, // outputs
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' },
				},
				{
					binding: 3, // board block positions
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 4, // ref color positions
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 5, // shine spots positions
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
			],
		});

		this.boardPipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [boardLayout] }),
			compute: {
				module: computeShaderModule,
				entryPoint: 'analyze_everything',
			},
		});
	}

	// -----------------------------
	// Helpers
	// -----------------------------

	makeBuffer(data, usage) {
		const buf = this.device.createBuffer({
			size: ((data.byteLength + 3) >> 2) << 2, // 4-byte align
			usage: usage | GPUBufferUsage.COPY_DST,
			mappedAtCreation: false,
		});
		this.device.queue.writeBuffer(
			buf,
			0,
			data.buffer,
			data.byteOffset,
			data.byteLength
		);
		return buf;
	}

	makeEmptyBuffer(sizeBytes, usage) {
		// round up to 4 bytes
		const size = ((sizeBytes + 3) >> 2) << 2;
		return this.device.createBuffer({ size, usage });
	}

	async readBuffer(buf, sizeBytes) {
		const size = ((sizeBytes + 3) >> 2) << 2;
		const staging = this.device.createBuffer({
			size,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		const encoder = this.device.createCommandEncoder();

		encoder.copyBufferToBuffer(buf, 0, staging, 0, size);

		this.device.queue.submit([encoder.finish()]);

		await staging.mapAsync(GPUMapMode.READ);

		const copy = staging.getMappedRange().slice(0);

		staging.unmap();
		staging.destroy();

		return copy;
	}

	// -----------------------------
	// 1) Digit matching
	// -----------------------------

	prepMatchDigitsGPUAssets(params) {
		const { texWidth, texHeight, digitSize, refDigits, numRefs, jobs } = params;

		if (this.matchDigitsAssets) {
			const { ubo, jobsBuf, refsBuf, outBuf } = this.matchDigitsAssets;
			ubo.destroy();
			jobsBuf.destroy();
			refsBuf.destroy();
			outBuf.destroy();
		}

		// Uniforms
		const refStride = digitSize * digitSize; // 196
		const numJobs = jobs.length;
		const matchUniform = new Uint32Array([
			texWidth,
			texHeight,
			digitSize,
			refStride,
			numJobs,
			numRefs,
			0,
			0,
		]);
		const ubo = this.makeBuffer(matchUniform, GPUBufferUsage.UNIFORM);

		// Jobs buffer
		const jobsData = new Uint32Array(numJobs * 4);
		for (let i = 0; i < numJobs; i++) {
			const j = jobs[i];
			const base = i * 4;
			jobsData[base + 0] = j.x >>> 0;
			jobsData[base + 1] = j.y >>> 0;
			jobsData[base + 2] = j.refIndex >>> 0;
			jobsData[base + 3] = 0;
		}
		const jobsBuf = this.makeBuffer(jobsData, GPUBufferUsage.STORAGE);

		// References buffer
		const refsBuf = this.makeBuffer(refDigits, GPUBufferUsage.STORAGE);

		// Output buffer, one f32 per job
		const outBuf = this.makeEmptyBuffer(
			numJobs * 4,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		);

		this.matchDigitsAssets = {
			numJobs,
			ubo,
			jobsBuf,
			refsBuf,
			outBuf,
		};
	}

	async matchDigits(params) {
		const { inputTexture } = params;
		const { numJobs, ubo, jobsBuf, refsBuf, outBuf } = this.matchDigitsAssets;

		// Bind group
		const bindGroup = this.matchPipeline.getBindGroupLayout(0);
		const bg = this.device.createBindGroup({
			layout: bindGroup,
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: ubo } },
				{ binding: 2, resource: { buffer: jobsBuf } },
				{ binding: 3, resource: { buffer: refsBuf } },
				{ binding: 4, resource: { buffer: outBuf } },
			],
		});

		// Dispatch
		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.matchPipeline);
		pass.setBindGroup(0, bg);
		const wgSize = 64; // hardcoded :( what is a good value here?
		const numWg = Math.ceil(numJobs / wgSize);
		pass.dispatchWorkgroups(numWg);
		pass.end();
		this.device.queue.submit([encoder.finish()]);

		// Read back
		const raw = await this.readBuffer(outBuf, numJobs * 4);
		return new Float32Array(raw);
	}

	// -----------------------------
	// 2) Board analysis
	// -----------------------------

	prepMatchNonDigitsGPUAssets(params) {
		const {
			texWidth,
			texHeight,
			threshold255,
			boardBlockPositions,
			refColorPositions,
			shinePositions,
		} = params;

		const numBlocks = boardBlockPositions.length;
		const numRefBlocks = refColorPositions.length;
		const numShineSpots = shinePositions.length;

		// Uniforms
		const boardUniform = new Uint32Array([
			texWidth,
			texHeight,
			threshold255 >>> 0,
			numShineSpots >>> 0,
			0,
			0,
		]);
		const ubo = this.makeBuffer(boardUniform, GPUBufferUsage.UNIFORM);

		// Positions
		const packIVec2 = arr => {
			const out = new Int32Array(arr.length * 2);
			for (let i = 0; i < arr.length; i++) {
				out[i * 2 + 0] = arr[i].x | 0;
				out[i * 2 + 1] = arr[i].y | 0;
			}
			return out;
		};
		const boardPosBuf = this.makeBuffer(
			packIVec2(boardBlockPositions),
			GPUBufferUsage.STORAGE
		);
		const refPosBuf = this.makeBuffer(
			packIVec2(refColorPositions),
			GPUBufferUsage.STORAGE
		);
		const shineBuf = this.makeBuffer(
			packIVec2(shinePositions),
			GPUBufferUsage.STORAGE
		);

		// Output buffer sizes
		const boardColorsAndShinesBytes = 200 * 4; // 200 u32
		const refColorsBytes = 3 * 4; // 3 u32
		const maxShineBytes = (14 + 20) * 4; // 28 u32
		const gymPauseBytes = 1 * 4; // 1 u32
		const totalBytes =
			boardColorsAndShinesBytes +
			refColorsBytes +
			maxShineBytes +
			gymPauseBytes;

		// We will write into a single slab that matches WGSL layout. The layout there is sequential.
		const outBuf = this.makeEmptyBuffer(
			totalBytes,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		);

		this.matchNonDigitsAssets = {
			numBlocks,
			numRefBlocks,
			numShineSpots,
			totalBytes,

			ubo,
			boardPosBuf,
			outBuf,
			refPosBuf,
			shineBuf,
		};
	}

	async analyzeBoard(params) {
		const { inputTexture } = params;
		const {
			numBlocks,
			numRefBlocks,
			numShineSpots,
			totalBytes,

			ubo,
			boardPosBuf,
			outBuf,
			refPosBuf,
			shineBuf,
		} = this.matchNonDigitsAssets;

		// Bind group
		const bindGroup = this.boardPipeline.getBindGroupLayout(0);
		const bg = this.device.createBindGroup({
			layout: bindGroup,
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: ubo } },
				{ binding: 2, resource: { buffer: outBuf } },
				{
					binding: 3,
					resource: { buffer: boardPosBuf },
				},
				{
					binding: 4,
					resource: { buffer: refPosBuf },
				},
				{
					binding: 5,
					resource: { buffer: shineBuf },
				},
			],
		});

		// Dispatch
		const totalInvocations = Math.max(
			numBlocks + numRefBlocks + numShineSpots,
			1
		);
		const wgSize = 256;
		const numWg = Math.ceil(totalInvocations / wgSize);

		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.boardPipeline);
		pass.setBindGroup(0, bg);
		pass.dispatchWorkgroups(numWg);
		pass.end();
		this.device.queue.submit([encoder.finish()]);

		// Read back once, then slice views according to the fixed layout
		const raw = await this.readBuffer(outBuf, totalBytes);

		const u32 = new Uint32Array(raw);
		const f32 = new Float32Array(raw);

		// TODO: get rid of hardcoded values
		let offU = 0;
		const boardColors = u32.subarray(offU, offU + 200);
		offU += 200;
		const refColors = u32.subarray(offU, offU + 3);
		offU += 3;
		const shines = u32.subarray(offU, offU + 34);
		offU += 34;
		const gymPauseF32 = f32[offU];

		// Return slices as copies to avoid holding the large buffer. Copy by new typed arrays.
		return {
			boardColors: new Uint32Array(boardColors),
			refColors: new Uint32Array(refColors),
			shines: new Uint32Array(shines),
			gymPauseF32,
		};
	}
}
