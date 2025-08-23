// ============================================
// WebGPU OCR Compute – TypeScript host code
// ============================================

export type IVec2 = { x: number; y: number };
export type MatchJob = { x: number; y: number; refIndex: number };

export type Offsets = {
	boardColorOffsets: IVec2[]; // length 4
	boardShineOffsets: IVec2[]; // length 3
	refColorOffsets: IVec2[]; // length 4
	shine14Offsets: IVec2[]; // length 3
};

export class OcrCompute {
	private device: GPUDevice;
	private shaderModule: GPUShaderModule;

	// Pipelines
	private matchPipeline: GPUComputePipeline;
	private boardPipeline: GPUComputePipeline;

	constructor(device: GPUDevice, shaderCode: string) {
		this.device = device;
		this.shaderModule = device.createShaderModule({ code: shaderCode });

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
			compute: { module: this.shaderModule, entryPoint: 'match_digits' },
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
				{
					binding: 5,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 6,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
			],
		});

		this.boardPipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [boardLayout] }),
			compute: { module: this.shaderModule, entryPoint: 'analyze_everything' },
		});
	}

	// -----------------------------
	// Helpers
	// -----------------------------

	private makeBuffer(
		data: ArrayBufferView,
		usage: GPUBufferUsageFlags
	): GPUBuffer {
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

	private makeEmptyBuffer(
		sizeBytes: number,
		usage: GPUBufferUsageFlags
	): GPUBuffer {
		// round up to 4 bytes
		const size = ((sizeBytes + 3) >> 2) << 2;
		return this.device.createBuffer({ size, usage });
	}

	private async readBuffer(
		buf: GPUBuffer,
		sizeBytes: number
	): Promise<ArrayBuffer> {
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

	async matchDigits(params: {
		inputTexture: GPUTexture;
		texWidth: number;
		texHeight: number;
		digitSize: number; // 14
		refDigits: Float32Array; // length = numRefs * 196
		numRefs: number;
		jobs: MatchJob[];
	}): Promise<Float32Array> {
		const {
			inputTexture,
			texWidth,
			texHeight,
			digitSize,
			refDigits,
			numRefs,
			jobs,
		} = params;

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
		const wgSize = 64;
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

	async analyzeBoard(params: {
		inputTexture: GPUTexture;
		texWidth: number;
		texHeight: number;
		threshold255: number; // 0..255 for shine
		boardPositions: IVec2[]; // length 200
		refBlockPositions: IVec2[]; // length 3
		shine14Positions: IVec2[]; // length 14
		offsets: Offsets; // exact counts required
	}): Promise<{
		boardColors: Float32Array; // 200 * 4
		boardShines: Uint32Array; // 200
		refColors: Float32Array; // 3 * 4
		shine14: Uint32Array; // 14
	}> {
		const {
			inputTexture,
			texWidth,
			texHeight,
			threshold255,
			boardPositions,
			refBlockPositions,
			shine14Positions,
			offsets,
		} = params;

		const numBlocks = boardPositions.length;
		const numRefBlocks = refBlockPositions.length;
		const numShineSpots = shine14Positions.length;

		// Uniforms
		const boardUniform = new Uint32Array([
			texWidth,
			texHeight,
			threshold255 >>> 0,
			numBlocks >>> 0,
			numRefBlocks >>> 0,
			numShineSpots >>> 0,
			0,
			0,
		]);
		const ubo = this.makeBuffer(boardUniform, GPUBufferUsage.UNIFORM);

		// Positions
		const packIVec2 = (arr: IVec2[]) => {
			const out = new Int32Array(arr.length * 2);
			for (let i = 0; i < arr.length; i++) {
				out[i * 2 + 0] = arr[i].x | 0;
				out[i * 2 + 1] = arr[i].y | 0;
			}
			return out;
		};
		const boardPosBuf = this.makeBuffer(
			packIVec2(boardPositions),
			GPUBufferUsage.STORAGE
		);
		const refPosBuf = this.makeBuffer(
			packIVec2(refBlockPositions),
			GPUBufferUsage.STORAGE
		);
		const shine14Buf = this.makeBuffer(
			packIVec2(shine14Positions),
			GPUBufferUsage.STORAGE
		);

		// Offsets buffer, in exact layout expected by WGSL
		const offs = new Int32Array((4 + 3 + 4 + 3) * 2);
		let k = 0;
		for (const v of offsets.boardColorOffsets) {
			offs[k++] = v.x | 0;
			offs[k++] = v.y | 0;
		}
		for (const v of offsets.boardShineOffsets) {
			offs[k++] = v.x | 0;
			offs[k++] = v.y | 0;
		}
		for (const v of offsets.refColorOffsets) {
			offs[k++] = v.x | 0;
			offs[k++] = v.y | 0;
		}
		for (const v of offsets.shine14Offsets) {
			offs[k++] = v.x | 0;
			offs[k++] = v.y | 0;
		}
		const offsBuf = this.makeBuffer(offs, GPUBufferUsage.STORAGE);

		// Output buffer sizes
		const boardColorsBytes = 200 * 4 * 4; // 200 vec4<f32>
		const boardShinesBytes = 200 * 4; // 200 u32
		const refColorsBytes = 3 * 4 * 4; // 3 vec4<f32>
		const shine14Bytes = 14 * 4; // 14 u32
		const totalBytes =
			boardColorsBytes + boardShinesBytes + refColorsBytes + shine14Bytes;

		// We will write into a single slab that matches WGSL layout. The layout there is sequential.
		const outBuf = this.makeEmptyBuffer(
			totalBytes,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
		);

		// Bind group
		const bindGroup = this.boardPipeline.getBindGroupLayout(0);
		const bg = this.device.createBindGroup({
			layout: bindGroup,
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: ubo } },
				{ binding: 2, resource: { buffer: boardPosBuf } },
				{ binding: 3, resource: { buffer: offsBuf } },
				{ binding: 4, resource: { buffer: outBuf } },
				{ binding: 5, resource: { buffer: refPosBuf } },
				{ binding: 6, resource: { buffer: shine14Buf } },
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
		const f32 = new Float32Array(raw);
		const u32 = new Uint32Array(raw);

		let offF = 0,
			offU = 0;
		const boardColors = f32.subarray(offF, offF + 200 * 4);
		offF += 200 * 4;
		offU = offF;
		const boardShines = u32.subarray(offU, offU + 200);
		offU += 200;
		offF = offU;
		const refColors = f32.subarray(offF, offF + 3 * 4);
		offF += 12;
		offU = offF;
		const shine14 = u32.subarray(offU, offU + 14);

		// Return slices as copies to avoid holding the large buffer. Copy by new typed arrays.
		return {
			boardColors: new Float32Array(boardColors),
			boardShines: new Uint32Array(boardShines),
			refColors: new Float32Array(refColors),
			shine14: new Uint32Array(shine14),
		};
	}
}
