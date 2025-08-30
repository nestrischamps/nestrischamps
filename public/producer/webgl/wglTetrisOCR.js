import { TetrisOCR } from '../TetrisOCR.js';

const TRANSFORM_TYPES = {
	NONE: 0,
	LUMA: 1,
	RED_LUMA: 2,
};

async function loadShaderSource(url) {
	return await fetch(url).then(res => res.text());
}

async function getShaderSources() {
	const [copy_vertex, copy_fragment, points_vertex, points_fragment] =
		await Promise.all([
			loadShaderSource('/producer/webgl/shaders/copy.vs.glsl'),
			loadShaderSource('/producer/webgl/shaders/copy.fs.glsl'),
			loadShaderSource('/producer/webgl/shaders/points.vs.glsl'),
			loadShaderSource('/producer/webgl/shaders/points.fs.glsl'),
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

export class WGlTetrisOCR extends TetrisOCR {
	#shaderSources;
	#digitLumas;
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

		// Quad VAO
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

	#initGpuAssets(frame) {
		this.#initGpuRenderAssets(frame);
	}

	renderExtractedRegions({ videoFrame, video }) {
		const gl = this.output_gl;

		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, gl.tex);
		gl.ctx.texImage2D(
			gl.ctx.TEXTURE_2D,
			0,
			gl.ctx.RGBA,
			gl.ctx.RGBA,
			gl.ctx.UNSIGNED_BYTE,
			videoFrame || video
		);
		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, null);

		gl.ctx.bindFramebuffer(gl.ctx.FRAMEBUFFER, null);
		gl.ctx.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		gl.ctx.clearColor(0.2, 0.2, 0.2, 1.0);
		gl.ctx.clear(gl.ctx.COLOR_BUFFER_BIT);

		gl.ctx.useProgram(gl.prog);

		// globals
		gl.ctx.uniform1i(gl.vars.uTex, 0);
		gl.ctx.uniform2i(
			gl.vars.uTexSize,
			this.capture_canvas.width,
			this.capture_canvas.height
		);
		gl.ctx.uniform2i(
			gl.vars.uOutSize,
			this.output_canvas.width,
			this.output_canvas.height
		);

		// variables
		gl.ctx.uniform1f(gl.vars.uBrightness, this.config.brightness);
		gl.ctx.uniform1f(gl.vars.uContrast, this.config.contrast);

		gl.ctx.activeTexture(gl.ctx.TEXTURE0);
		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, gl.tex);
		gl.ctx.bindVertexArray(gl.vao);

		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// Map source pixels to normalized rect
			gl.ctx.uniform4i(
				gl.vars.uSrcPx,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
			gl.ctx.uniform4i(
				gl.vars.uDstPx,
				task.packing_pos.x,
				task.packing_pos.y,
				task.canvas.width,
				task.canvas.height
			);

			// Get the transform type from task configuration
			const transformType = task.luma
				? TRANSFORM_TYPES.LUMA
				: task.red_luma
					? TRANSFORM_TYPES.RED_LUMA
					: TRANSFORM_TYPES.NONE;

			gl.ctx.uniform1i(gl.vars.uMode, transformType);

			// Draw this region into its destination via viewport scaling
			gl.ctx.drawArrays(gl.ctx.TRIANGLES, 0, 6);
		});

		gl.ctx.bindVertexArray(null);
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
