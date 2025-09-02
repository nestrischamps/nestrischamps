import { GpuTetrisOCR } from '../gpuTetrisOCR.js';
import { PATTERN_MAX_INDEXES } from '../constants.js';
import { findMinIndex, u32ToRgba } from '/ocr/utils.js';

const MAX_SHINE_SPOTS = 20 + 14;

async function getShaderSources() {
	const [copy_vertex, copy_fragment, ocr_vertex, ocr_fragment] =
		await Promise.all([
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/copy.vs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/copy.fs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/ocr.vs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/ocr.fs.glsl'),
		]);

	const shaders = {
		copy_vertex,
		copy_fragment,
		ocr_vertex,
		ocr_fragment,
	};

	return shaders;
}

let getShaderSourcesPromise;

function lazyGetShaderSources() {
	if (!getShaderSourcesPromise) {
		getShaderSourcesPromise = getShaderSources(); // no await!
	}

	return getShaderSourcesPromise;
}

// gl helpers

function sh(gl, type, src) {
	const s = gl.createShader(type);

	gl.shaderSource(s, src);
	gl.compileShader(s);

	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.error(type, src);
		throw new Error(gl.getShaderInfoLog(s));
	}

	return s;
}

function createGlProgram(gl, vs, fs) {
	const p = gl.createProgram();

	gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs));
	gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
	gl.linkProgram(p);

	if (!gl.getProgramParameter(p, gl.LINK_STATUS))
		throw new Error(gl.getProgramInfoLog(p));

	return p;
}

function makeTexture(gl, w, h, filter = gl.NEAREST) {
	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		w,
		h,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		null
	);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return tex;
}

function makeFrameBufferO(gl, tex) {
	const fb = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		tex,
		0
	);
	const ok =
		gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (!ok) throw new Error('FBO incomplete');

	return fb;
}

function makedigitLumaRefsTex(gl, refsF32) {
	const tex = gl.createTexture();

	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);

	// Float texture (sampling only; we don't render to it); R32F needs no extension
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.R32F,
		refsF32.length,
		1,
		0,
		gl.RED,
		gl.FLOAT,
		refsF32
	);

	gl.bindTexture(gl.TEXTURE_2D, null);

	return tex;
}

function makeDigitJobsTex(gl, jobs) {
	const N = jobs.length;
	const data = new Uint32Array(N * 4);
	for (let i = 0; i < N; i++) {
		const j = jobs[i];
		data[i * 4 + 0] = j.x >>> 0;
		data[i * 4 + 1] = j.y >>> 0;
		data[i * 4 + 2] = j.refIndex >>> 0;
		data[i * 4 + 3] = 0;
	}
	const tex = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	// Integer texture (sampling only; we don't render to it)
	// gl.texImage2D(
	// 	gl.TEXTURE_2D,
	// 	0,
	// 	gl.RGBA32UI, // internal format
	// 	N, // width=N
	// 	1, // height=1
	// 	0,
	// 	gl.RGBA_INTEGER, // format for integer textures
	// 	gl.UNSIGNED_INT, // type
	// 	data
	// );

	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, N, 1);
	gl.texSubImage2D(
		gl.TEXTURE_2D,
		0,
		0,
		0,
		N,
		1,
		gl.RGBA_INTEGER,
		gl.UNSIGNED_INT,
		data
	);

	gl.bindTexture(gl.TEXTURE_2D, null);

	return tex;
}

export class WGlTetrisOCR extends GpuTetrisOCR {
	#shaderSources;
	#ready = false;

	constructor(config) {
		super(config);

		Promise.all([lazyGetShaderSources(), this.loadDigitTemplates()]).then(
			([shader_sources]) => {
				this.#shaderSources = shader_sources;

				this.#initGpuAssets();

				this.#ready = true;
			}
		);
	}

	setConfig(config) {
		super.setConfig(config);
	}

	updateScore67Config() {
		this.#prepGpuComputeDigitAssets();
		this.#initGpuComputeAssets2();
	}

	#initGpuRenderAssets() {
		const { copy_vertex, copy_fragment } = this.#shaderSources;

		const gl = (this.output_gl = {
			ctx: this.output_canvas.getContext('webgl2', {
				premultipliedAlpha: false,
			}),
		});

		const glc = gl.ctx;

		gl.atlasTex = makeTexture(
			glc,
			this.output_canvas.width,
			this.output_canvas.height,
			glc.LINEAR
		);
		gl.atlasFBO = makeFrameBufferO(glc, gl.atlasTex);

		const prog = createGlProgram(glc, copy_vertex, copy_fragment);

		gl.copy = {
			prog,

			vao: glc.createVertexArray(),

			u: {
				uTex: glc.getUniformLocation(prog, 'uTex'),
				uTexSize: glc.getUniformLocation(prog, 'uTexSize'),
				uOutSize: glc.getUniformLocation(prog, 'uOutSize'),
				uFlipY: glc.getUniformLocation(prog, 'uFlipY'),
				uSrcPx: glc.getUniformLocation(prog, 'uSrcPx'),
				uDstPx: glc.getUniformLocation(prog, 'uDstPx'),
				uMode: glc.getUniformLocation(prog, 'uMode'), // luma/red-luma processing
				uBrightness: glc.getUniformLocation(prog, 'uBrightness'),
				uContrast: glc.getUniformLocation(prog, 'uContrast'),
			},
		};

		// Program and locations
		glc.useProgram(gl.copy.prog);

		gl.videoTex = glc.createTexture();
		glc.bindTexture(glc.TEXTURE_2D, gl.videoTex);
		glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MIN_FILTER, glc.LINEAR);
		glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MAG_FILTER, glc.LINEAR);
		glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_S, glc.CLAMP_TO_EDGE);
		glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_T, glc.CLAMP_TO_EDGE);
		glc.bindTexture(glc.TEXTURE_2D, null);

		gl.nearestSampler = glc.createSampler();
		glc.samplerParameteri(
			gl.nearestSampler,
			glc.TEXTURE_MIN_FILTER,
			glc.NEAREST
		);
		glc.samplerParameteri(
			gl.nearestSampler,
			glc.TEXTURE_MAG_FILTER,
			glc.NEAREST
		);
		glc.samplerParameteri(
			gl.nearestSampler,
			glc.TEXTURE_WRAP_S,
			glc.CLAMP_TO_EDGE
		);
		glc.samplerParameteri(
			gl.nearestSampler,
			glc.TEXTURE_WRAP_T,
			glc.CLAMP_TO_EDGE
		);

		for (const task of Object.values(this.config.tasks)) {
			task.canvas_ctx = task.canvas.getContext('2d', { alpha: false });
		}
	}

	#prepGpuComputeDigitAssets() {
		const gl = this.output_gl;
		const glc = gl.ctx;

		const digitSizeWBorder = 16;

		this.digitFields = this.configData.fields
			.filter(name => this.config.tasks[name].pattern)
			.map(name => ({ name, task: this.config.tasks[name] }));

		// TODO: no need to store address of uniforms
		// they are not used outside of this function
		Object.assign(gl.ocr.u, {
			uNumReferenceDigits: glc.getUniformLocation(
				gl.ocr.prog,
				'uNumReferenceDigits'
			),
			uReferenceDigitsTex: glc.getUniformLocation(
				gl.ocr.prog,
				'uReferenceDigitsTex'
			),
			uNumDigitJobs: glc.getUniformLocation(gl.ocr.prog, 'uNumDigitJobs'),
			uDigitJobsTex: glc.getUniformLocation(gl.ocr.prog, 'uDigitJobsTex'),
		});

		// prepare all digit jobs
		const allDigitJobs = [];

		this.digitFields.forEach(({ task }) => {
			const { x, y } = task.packing_pos;

			// TODO: handle packing of the T T_T

			task.patternJobs = [];
			task.pattern.split('').forEach((pid, pidx) => {
				const maxIndex = PATTERN_MAX_INDEXES[pid] || 1;
				const curDigitJobs = [];

				for (let refIndex = 0; refIndex < maxIndex; refIndex++) {
					const job = {
						x: x + digitSizeWBorder * pidx,
						y,
						refIndex,
					};
					curDigitJobs.push(job);
					allDigitJobs.push(job);
				}

				task.patternJobs.push(curDigitJobs);
			});
		});

		gl.ocr.digitJobs = allDigitJobs;

		if (gl.ocr.digitJobsTex) {
			glc.deleteTexture(gl.ocr.digitJobsTex);
			glc.deleteTexture(gl.ocr.referenceDigitsTex);
		}

		gl.ocr.digitJobsTex = makeDigitJobsTex(glc, allDigitJobs);
		gl.ocr.referenceDigitsTex = makedigitLumaRefsTex(glc, this.digit_lumas_f32);

		glc.uniform1i(gl.ocr.u.uNumReferenceDigits, 17); // is this needed?
		glc.uniform1i(gl.ocr.u.uNumDigitJobs, allDigitJobs.length);

		glc.activeTexture(glc.TEXTURE1);
		glc.bindTexture(glc.TEXTURE_2D, gl.ocr.referenceDigitsTex);
		glc.uniform1i(gl.ocr.u.uReferenceDigitsTex, 1);

		glc.activeTexture(glc.TEXTURE2);
		glc.bindTexture(glc.TEXTURE_2D, gl.ocr.digitJobsTex);
		glc.uniform1i(gl.ocr.u.uDigitJobsTex, 2);

		// restore texture zero
		glc.activeTexture(glc.TEXTURE0);
	}

	#prepGpuComputeNonDigitAssets() {
		const gl = this.output_gl;
		const glc = gl.ctx;

		// TODO: no need to store address of uniforms
		// they are not used outside of this function
		Object.assign(gl.ocr.u, {
			uBoardTLPosition: glc.getUniformLocation(gl.ocr.prog, 'uBoardTLPosition'), // ivec2
			uRefColorPositions: glc.getUniformLocation(
				gl.ocr.prog,
				'uRefColorPositions'
			), // ivec2[3]
			uShineThreshold: glc.getUniformLocation(gl.ocr.prog, 'uShineThreshold'),
			uNumShinePositions: glc.getUniformLocation(
				gl.ocr.prog,
				'uNumShinePositions'
			),
			uShinePositions: glc.getUniformLocation(gl.ocr.prog, 'uShinePositions'),
		});

		// prepare the ocr to write+sample
		const previewPos = this.config.tasks.preview.packing_pos;

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

		// prep and assign uniform values now
		const fieldPos = this.config.tasks.field.packing_pos;

		const refColorPositionsI32 = new Int32Array(refColorPositions.length * 2);
		for (let i = 0; i < refColorPositions.length; i++) {
			refColorPositionsI32[i * 2 + 0] = refColorPositions[i].x;
			refColorPositionsI32[i * 2 + 1] = refColorPositions[i].y;
		}

		const shinePositionsI32 = new Int32Array(MAX_SHINE_SPOTS * 2);
		for (let i = 0; i < shinePositions.length; i++) {
			shinePositionsI32[i * 2 + 0] = shinePositions[i].x;
			shinePositionsI32[i * 2 + 1] = shinePositions[i].y;
		}

		// store for safekeeping
		gl.ocr.refColorPositions = refColorPositions;
		gl.ocr.shinePositions = shinePositionsI32;

		// assign uniform values into program
		glc.uniform2i(gl.ocr.u.uBoardTLPosition, fieldPos.x, fieldPos.y);
		glc.uniform2iv(gl.ocr.u.uRefColorPositions, refColorPositionsI32);
		glc.uniform1i(gl.ocr.u.uShineThreshold, GpuTetrisOCR.lumaThreshold255);
		glc.uniform1i(gl.ocr.u.uNumShinePositions, shinePositions.length);
		glc.uniform2iv(gl.ocr.u.uShinePositions, shinePositionsI32);
	}

	#initGpuComputeAssets() {
		const gl = this.output_gl;
		const glc = gl.ctx;

		// TODO: clear ALL texture ref ad binding, so we start fresh
		// Only needed for the score 6/7 live switching
		// Can we always reserve a slot for score7, such that there's no need to change anything when it flips?

		const prog = createGlProgram(
			gl.ctx,
			this.#shaderSources.ocr_vertex,
			this.#shaderSources.ocr_fragment
		);

		gl.ocr = {
			prog,

			// oputput
			vao: glc.createVertexArray(),
			vbo: glc.createBuffer(),

			// uniform variables
			u: {
				uNumTotalJobs: glc.getUniformLocation(prog, 'uNumTotalJobs'),
				uAtlasSize: glc.getUniformLocation(prog, 'uAtlasSize'),
				uAtlasTex: glc.getUniformLocation(prog, 'uAtlasTex'),
			},
		};

		glc.useProgram(gl.ocr.prog);

		glc.uniform2i(
			gl.ocr.u.uAtlasSize,
			this.output_canvas.width,
			this.output_canvas.height
		);

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.uniform1i(gl.ocr.u.uAtlasTex, 0);

		this.#prepGpuComputeDigitAssets();
		this.#prepGpuComputeNonDigitAssets();
		this.#initGpuComputeAssets2();
	}

	#initGpuComputeAssets2() {
		const gl = this.output_gl;
		const glc = gl.ctx;

		gl.ocr.numTotalJobs =
			gl.ocr.digitJobs.length +
			200 + // bloard blocks
			3 +
			MAX_SHINE_SPOTS + // always reserve max shine spots
			1; // gym pause;

		console.log({
			uNumTotalJobs: gl.ocr.numTotalJobs,
		});

		glc.uniform1i(gl.ocr.u.uNumTotalJobs, gl.ocr.numTotalJobs);

		gl.ocr.resultTex = makeTexture(glc, gl.ocr.numTotalJobs, 1);
		gl.ocr.resultFBO = makeFrameBufferO(glc, gl.ocr.resultTex);

		const cap = Math.max(gl.ocr.numTotalJobs, 512);

		const idx = new Float32Array(cap);
		for (let i = 0; i < cap; i++) idx[i] = i;

		glc.bindBuffer(glc.ARRAY_BUFFER, gl.ocr.vbo);
		glc.bufferData(glc.ARRAY_BUFFER, idx, glc.STATIC_DRAW);
		gl.ocr.vboCap = cap;

		glc.bindVertexArray(gl.ocr.vao);
		glc.bindBuffer(glc.ARRAY_BUFFER, gl.ocr.vbo);
		glc.enableVertexAttribArray(0);
		glc.vertexAttribPointer(0, 1, glc.FLOAT, false, 4, 0); // aIndex @ loc 0
		glc.bindVertexArray(null);
	}

	#initGpuAssets(frame) {
		this.#initGpuRenderAssets(frame);
		this.#initGpuComputeAssets(frame);
	}

	runPass1ToAtlas({ videoFrame, video }) {
		const gl = this.output_gl;
		const glc = gl.ctx;

		glc.enable(glc.BLEND); // blending enabled for smooth resize

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.videoTex);
		glc.texImage2D(
			glc.TEXTURE_2D,
			0,
			glc.RGBA,
			glc.RGBA,
			glc.UNSIGNED_BYTE,
			videoFrame || video
		);

		glc.bindFramebuffer(glc.FRAMEBUFFER, gl.atlasFBO);
		glc.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		glc.clearColor(0.2, 0.2, 0.2, 1.0);
		glc.clear(glc.COLOR_BUFFER_BIT);

		glc.useProgram(gl.copy.prog);

		// globals
		glc.uniform1i(gl.copy.u.uTex, 0);
		glc.uniform2i(gl.copy.u.uTexSize, video.videoWidth, video.videoHeight);
		glc.uniform2i(
			gl.copy.u.uOutSize,
			this.output_canvas.width,
			this.output_canvas.height
		);

		// variables
		glc.uniform1f(gl.copy.u.uFlipY, 1);
		glc.uniform1f(gl.copy.u.uBrightness, this.config.brightness);
		glc.uniform1f(gl.copy.u.uContrast, this.config.contrast);

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.videoTex);
		glc.bindVertexArray(gl.copy.vao);

		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// Map source pixels to normalized rect
			glc.uniform4i(
				gl.copy.u.uSrcPx,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
			glc.uniform4i(
				gl.copy.u.uDstPx,
				task.packing_pos.x,
				task.packing_pos.y,
				task.canvas.width,
				task.canvas.height
			);

			// Get the transform type from task configuration
			const transformType = task.luma
				? GpuTetrisOCR.TRANSFORM_TYPES.LUMA
				: task.red_luma
					? GpuTetrisOCR.TRANSFORM_TYPES.RED_LUMA
					: GpuTetrisOCR.TRANSFORM_TYPES.NONE;

			glc.uniform1i(gl.copy.u.uMode, transformType);

			// Draw this region into its destination via viewport scaling
			glc.drawArrays(glc.TRIANGLES, 0, 6);
		});

		glc.bindVertexArray(null);
		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
	}

	runPass2AtlasToCanvas() {
		// blit
		const gl = this.output_gl;
		const glc = gl.ctx;

		glc.useProgram(gl.copy.prog);

		glc.disable(glc.BLEND);
		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
		glc.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		glc.clearColor(0.2, 0.2, 0.2, 1);
		glc.clear(glc.COLOR_BUFFER_BIT);

		glc.uniform1i(gl.copy.u.uTex, 0);
		glc.uniform2i(
			gl.copy.u.uTexSize,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform2i(
			gl.copy.u.uOutSize,
			this.output_canvas.width,
			this.output_canvas.height
		);

		// important: reset brightness and contrast to 1, or they wouldbe double applied from the atlas texture
		glc.uniform1f(gl.copy.u.uFlipY, 0);
		glc.uniform1f(gl.copy.u.uBrightness, 1.0);
		glc.uniform1f(gl.copy.u.uContrast, 1.0);

		glc.uniform4i(
			gl.copy.u.uSrcPx,
			0,
			0,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform4i(
			gl.copy.u.uDstPx,
			0,
			0,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform1i(gl.copy.u.uMode, 0);

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.bindSampler(0, gl.nearestSampler);

		glc.bindVertexArray(gl.copy.vao);
		glc.drawArrays(glc.TRIANGLES, 0, 6);

		glc.bindVertexArray(null);
		glc.bindSampler(0, null);
	}

	runPass3OcrToFinalTexture() {
		const gl = this.output_gl;
		const glc = gl.ctx;

		glc.useProgram(gl.ocr.prog);

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.bindSampler(0, gl.nearestSampler);

		// ----- bind FBO and clear -----
		glc.bindFramebuffer(glc.FRAMEBUFFER, gl.ocr.resultFBO);
		glc.viewport(0, 0, gl.ocr.numTotalJobs, 1);
		glc.disable(glc.BLEND);
		glc.clearColor(0, 0, 0, 0);
		glc.clear(glc.COLOR_BUFFER_BIT);

		// ----- draw N points -----
		glc.bindVertexArray(gl.ocr.vao);
		glc.drawArrays(glc.POINTS, 0, gl.ocr.numTotalJobs);
		glc.bindVertexArray(null);

		// ----- readback -----
		if (
			!this.ocrResultsU8 ||
			this.ocrResultsU8.length !== gl.ocr.numTotalJobs * 4
		) {
			this.ocrResultsU8 = new Uint8Array(gl.ocr.numTotalJobs * 4);
		}

		glc.flush();

		performance.mark(`start-read-${this.perfSuffix}`);
		glc.readPixels(
			0,
			0,
			gl.ocr.numTotalJobs,
			1,
			glc.RGBA,
			glc.UNSIGNED_BYTE,
			this.ocrResultsU8
		);
		performance.mark(`end-read-${this.perfSuffix}`);
		performance.measure(
			`read-${this.perfSuffix}`,
			`start-read-${this.perfSuffix}`,
			`end-read-${this.perfSuffix}`
		);

		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
	}

	processResults() {
		const u32 = new Uint32Array(this.ocrResultsU8.buffer);

		let offU = 0;
		const allDigitsJobs = u32.subarray(
			offU,
			offU + this.output_gl.ocr.digitJobs.length
		);
		offU += this.output_gl.ocr.digitJobs.length;
		const boardColors = u32.subarray(offU, offU + 200);
		offU += 200;
		const refColors = u32.subarray(offU, offU + 3);
		offU += 3;
		const shines = u32.subarray(offU, offU + MAX_SHINE_SPOTS);
		offU += MAX_SHINE_SPOTS;
		const gymPauseU32 = u32[offU];

		const temp = {
			allDigitsJobs: new Uint32Array(allDigitsJobs),
			boardColors: new Uint32Array(boardColors),
			refColors: new Uint32Array(refColors),
			shines: new Uint32Array(shines),
			gymPauseU32,
		};

		const res = {
			field: boardColors,
			preview: GpuTetrisOCR.getPreviewFromShines(shines.subarray(0, 14)),
		};

		if (this.config.tasks.cur_piece) {
			res.cur_piece = GpuTetrisOCR.getCurPieceFromShines(shines.subarray(14));
		}

		if (this.config.tasks.color1) {
			res.color1 = u32ToRgba(refColors[0]);
			res.color2 = u32ToRgba(refColors[1]);
			res.color3 = u32ToRgba(refColors[2]);
		}

		let curSseIdx = 0;

		// hgandle digit fields
		this.digitFields.forEach(({ name, task }) => {
			const matches = task.patternJobs.map(curDigitJobs => {
				const lumaSses = allDigitsJobs.subarray(
					curSseIdx,
					curSseIdx + curDigitJobs.length
				);
				const indexMatch = findMinIndex(lumaSses);

				curSseIdx += curDigitJobs.length;

				return indexMatch ? indexMatch - 1 : null;
			});

			res[name] = matches.some(v => v === null) ? null : matches;
		});

		return res;
	}

	async processVideoFrame(frame) {
		if (!this.#ready) return;

		super.processVideoFrame(frame);

		performance.mark(`start-processVideoFrame-${this.perfSuffix}`);

		this.runPass1ToAtlas(frame);

		if (this.config.show_capture_ui) {
			this.extractAndHighlightRegions(frame);
			this.runPass2AtlasToCanvas(frame);
		}

		await this.runPass3OcrToFinalTexture(frame);

		const results = this.processResults();

		performance.mark(`end-processVideoFrame-${this.perfSuffix}`);
		performance.measure(
			`processVideoFrame-${this.perfSuffix}`,
			`start-processVideoFrame-${this.perfSuffix}`,
			`end-processVideoFrame-${this.perfSuffix}`
		);

		const event = new CustomEvent('frame', {
			detail: results,
		});
		this.dispatchEvent(event);
	}
}
