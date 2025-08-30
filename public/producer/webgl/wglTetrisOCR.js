import { GpuTetrisOCR } from '../gpuTetrisOCR';

async function getShaderSources() {
	const [copy_vertex, copy_fragment, points_vertex, points_fragment] =
		await Promise.all([
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/copy.vs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/copy.fs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/points.vs.glsl'),
			GpuTetrisOCR.loadShaderSource('/producer/webgl/shaders/points.fs.glsl'),
		]);

	const shaders = {
		copy_vertex,
		copy_fragment,
		points_vertex,
		points_fragment,
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
// Small helper
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

function prog(gl, vs, fs) {
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

export class WGlTetrisOCR extends GpuTetrisOCR {
	#shaderSources;
	#ready = false;

	constructor(config) {
		super(config);

		this.instrument(
			'extractAndHighlightRegions',
			'processVideoFrame',
			'renderExtractedRegions'
		);

		Promise.all([lazyGetShaderSources(), TetrisOCR.loadDigitTemplates()]).then(
			([shader_sources, digit_lumas]) => {
				this.#shaderSources = shader_sources;
				this.#digitLumas = digit_lumas;

				this.#initGpuAssets();

				this.#ready = true;
			}
		);
	}

	setConfig(config) {
		super.setConfig(config);
	}

	updateScore67Config() {
		// this.#prepGpuComputeDigitAssets();
	}

	#initGpuRenderAssets() {
		const { copy_vertex, copy_fragment } = this.#shaderSources;

		const gl = (this.output_gl = {
			ctx: this.output_canvas.getContext('webgl2', {
				premultipliedAlpha: false,
			}),
		});

		gl.atlasTex = makeTexture(
			gl.ctx,
			this.output_canvas.width,
			this.output_canvas,
			height,
			gl.ctx.LINEAR
		);
		gl.atlasFBO = makeFrameBufferO(gl.ctx, gl.atlasTex);

		// Pass 2 target (final extraction)
		gl.finalTex = makeTexture(gl.ctx, FINAL_W, FINAL_H, gl.ctx.NEAREST);
		gl.finalFBO = makeFrameBufferO(gl.ctx, gl.finalTex);

		// Program and locations
		gl.prog = prog(gl.ctx, copy_vertex, copy_fragment);

		gl.vars = {
			uTex: gl.ctx.getUniformLocation(gl.prog, 'uTex'),
			uTexSize: gl.ctx.getUniformLocation(gl.prog, 'uTexSize'),
			uOutSize: gl.ctx.getUniformLocation(gl.prog, 'uOutSize'),
			uSrcPx: gl.ctx.getUniformLocation(gl.prog, 'uSrcPx'),
			uDstPx: gl.ctx.getUniformLocation(gl.prog, 'uDstPx'),
			uMode: gl.ctx.getUniformLocation(gl.prog, 'uMode'), // luma/red-luma processing
			uBrightness: gl.ctx.getUniformLocation(gl.prog, 'uBrightness'),
			uContrast: gl.ctx.getUniformLocation(gl.prog, 'uContrast'),
		};

		gl.vao = gl.ctx.createVertexArray();

		gl.tex = gl.ctx.createTexture();
		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, gl.tex);
		gl.ctx.texParameteri(
			gl.ctx.TEXTURE_2D,
			gl.ctx.TEXTURE_MIN_FILTER,
			gl.ctx.LINEAR
		);
		gl.ctx.texParameteri(
			gl.ctx.TEXTURE_2D,
			gl.ctx.TEXTURE_MAG_FILTER,
			gl.ctx.LINEAR
		);
		gl.ctx.texParameteri(
			gl.ctx.TEXTURE_2D,
			gl.ctx.TEXTURE_WRAP_S,
			gl.ctx.CLAMP_TO_EDGE
		);
		gl.ctx.texParameteri(
			gl.ctx.TEXTURE_2D,
			gl.ctx.TEXTURE_WRAP_T,
			gl.ctx.CLAMP_TO_EDGE
		);
		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, null);

		for (const task of Object.values(this.config.tasks)) {
			task.canvas_ctx = task.canvas.getContext('2d', { alpha: false });
		}
	}

	#initGpuComputeAssets() {
		const gl = this.output_gl;

		gl.pointsProg = prog(
			gl.ctx,
			this.#shaderSources.points_vertex,
			this.#shaderSources.points_fragment
		);

		gl.points = {
			vao: gl.ctx.createVertexArray(),
			vbo: gl.ctx.createBuffer(),
			u: {
				uAtlas: gl.ctx.getUniformLocation(gl.pointsProg, 'uAtlas'),
				uAtlasSize: gl.ctx.getUniformLocation(gl.pointsProg, 'uAtlasSize'),
				uFinalSize: gl.ctx.getUniformLocation(gl.pointsProg, 'uFinalSize'),
				uNumOffsets: gl.ctx.getUniformLocation(gl.pointsProg, 'uNumOffsets'),
				uOffsets: gl.ctx.getUniformLocation(gl.pointsProg, 'uOffsets[0]'),
				uShineThresh: gl.ctx.getUniformLocation(
					gl.pointsProg,
					'uShineThreshold'
				),
				uMode: gl.ctx.getUniformLocation(gl.pointsProg, 'uMode'),
			},
		};

		gl.ctx.bindVertexArray(gl.points.vao);
		gl.ctx.bindBuffer(gl.ctx.ARRAY_BUFFER, gl.points.vbo);
		// aDstXY @ loc 0 (2 floats), aSrcPx @ loc 1 (4 floats), stride 24
		gl.ctx.enableVertexAttribArray(0);
		gl.ctx.vertexAttribPointer(0, 2, gl.ctx.FLOAT, false, 24, 0);
		gl.ctx.enableVertexAttribArray(1);
		gl.ctx.vertexAttribPointer(1, 4, gl.ctx.FLOAT, false, 24, 8);
		gl.ctx.bindVertexArray(null);
	}

	#initGpuAssets(frame) {
		this.#initGpuRenderAssets(frame);
		this.#initGpuComputeAssets(frame);
	}

	runPass1ToAtlas({ videoFrame, video }) {
		const gl = this.output_gl;
		const glc = gl.ctx;

		glc.bindTexture(glc.TEXTURE_2D, gl.tex);
		glc.texImage2D(
			glc.TEXTURE_2D,
			0,
			glc.RGBA,
			glc.RGBA,
			glc.UNSIGNED_BYTE,
			videoFrame || video
		);
		glc.bindTexture(glc.TEXTURE_2D, null);

		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
		glc.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		glc.clearColor(0.2, 0.2, 0.2, 1.0);
		glc.clear(glc.COLOR_BUFFER_BIT);

		glc.useProgram(gl.prog);

		// globals
		glc.uniform1i(gl.vars.uTex, 0);
		glc.uniform2i(
			gl.vars.uTexSize,
			this.capture_canvas.width,
			this.capture_canvas.height
		);
		glc.uniform2i(
			gl.vars.uOutSize,
			this.output_canvas.width,
			this.output_canvas.height
		);

		// variables
		glc.uniform1f(gl.vars.uBrightness, this.config.brightness);
		glc.uniform1f(gl.vars.uContrast, this.config.contrast);

		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.tex);
		glc.bindVertexArray(gl.vao);

		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// Map source pixels to normalized rect
			glc.uniform4i(
				gl.vars.uSrcPx,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
			glc.uniform4i(
				gl.vars.uDstPx,
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

			glc.uniform1i(gl.vars.uMode, transformType);

			// Draw this region into its destination via viewport scaling
			glc.drawArrays(glc.TRIANGLES, 0, 6);
		});

		glc.bindVertexArray(null);
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

		if (!this.capture_ctx) {
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
		this.capture_ctx.filter = 'none';

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

		this.extractAndHighlightRegions(frame);
		this.renderExtractedRegions(frame);

		const event = new CustomEvent('frame', {
			detail: {},
		});
		this.dispatchEvent(event);
	}
}
