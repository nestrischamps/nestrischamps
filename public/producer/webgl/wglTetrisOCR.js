import { GpuTetrisOCR } from '../gpuTetrisOCR';
import { CONFIGS, getDigitsWidth } from '../constants';
import { name } from 'ejs';

const CRAMMED = {
	classic: {
		size: { w: getDigitsWidth(7), h: 72 },
		positions: {
			// digits data
			score: { x: 0, y: 0 },
			lines: { x: 0, y: 14 },
			level: { x: 48, y: 14 },

			// Split T into 3 chunks to pack them on the lines with the other
			Td1: { x: 96, y: 28 },
			Td2: { x: 96, y: 42 },
			Td3: { x: 96, y: 56 },

			// other piece stats are as-is
			J: { x: 0, y: 28 },
			Z: { x: 48, y: 28 },
			O: { x: 0, y: 42 },
			S: { x: 48, y: 42 },
			L: { x: 0, y: 56 },
			I: { x: 48, y: 56 },

			// pixel data
			block_pixels_1: { x: 0, y: 70, count: 100 },
			block_pixels_2: { x: 0, y: 71, count: 100 },
			shine_pixels: { x: 0, y: 72 },
			ref_color_pixels: { x: 35, y: 72 },
		},
	},
	das_trainer: {
		size: { w: getDigitsWidth(7), h: 45 },
		positions: {
			// digits data
			score: { x: 0, y: 0 },
			lines: { x: 0, y: 14 },
			level: { x: 48, y: 14 },
			instant_das: { x: 0, y: 28 },
			cur_piece_das: { x: 32, y: 28 },

			// pixel data
			block_pixels_1: { x: 0, y: 42, count: 100 },
			block_pixels_2: { x: 0, y: 43, count: 100 },
			shine_pixels: { x: 0, y: 44 },
		},
	},
	minimal: {
		size: { w: getDigitsWidth(7), h: 31 },
		positions: {
			// digits data
			score: { x: 0, y: 0 },
			lines: { x: 0, y: 14 },
			level: { x: 48, y: 14 },

			// pixel data
			block_pixels_1: { x: 0, y: 28, count: 100 },
			block_pixels_2: { x: 0, y: 29, count: 100 },
			shine_pixels: { x: 0, y: 30 },
		},
	},
};

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

		// Program and locations
		gl.copyProg = prog(gl.ctx, copy_vertex, copy_fragment);

		gl.vars = {
			uTex: gl.ctx.getUniformLocation(gl.copyProg, 'uTex'),
			uTexSize: gl.ctx.getUniformLocation(gl.copyProg, 'uTexSize'),
			uOutSize: gl.ctx.getUniformLocation(gl.copyProg, 'uOutSize'),
			uSrcPx: gl.ctx.getUniformLocation(gl.copyProg, 'uSrcPx'),
			uDstPx: gl.ctx.getUniformLocation(gl.copyProg, 'uDstPx'),
			uMode: gl.ctx.getUniformLocation(gl.copyProg, 'uMode'), // luma/red-luma processing
			uBrightness: gl.ctx.getUniformLocation(gl.copyProg, 'uBrightness'),
			uContrast: gl.ctx.getUniformLocation(gl.copyProg, 'uContrast'),
		};

		gl.vao = gl.ctx.createVertexArray();

		gl.videoTex = gl.ctx.createTexture();
		gl.ctx.bindTexture(gl.ctx.TEXTURE_2D, gl.videoTex);
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

		gl.finalTex = makeTexture(gl.ctx, FINAL_W, FINAL_H, gl.ctx.NEAREST);
		gl.finalFBO = makeFrameBufferO(gl.ctx, gl.finalTex);

		gl.nearestSampler = gl.createSampler();
		gl.samplerParameteri(gl.nearestSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.samplerParameteri(gl.nearestSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.samplerParameteri(
			gl.nearestSampler,
			gl.TEXTURE_WRAP_S,
			gl.CLAMP_TO_EDGE
		);
		gl.samplerParameteri(
			gl.nearestSampler,
			gl.TEXTURE_WRAP_T,
			gl.CLAMP_TO_EDGE
		);

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
		// aDstXY at location 0
		gl.ctx.enableVertexAttribArray(0);
		gl.ctx.vertexAttribPointer(0, 2, gl.ctx.FLOAT, false, 16, 0);
		// aSrcTL at location 1
		gl.ctx.enableVertexAttribArray(1);
		gl.ctx.vertexAttribPointer(1, 2, gl.ctx.FLOAT, false, 16, 8);
		gl.ctx.bindVertexArray(null);

		// the easy bit!
		this.digitFields = this.configData.fields
			.filter(name => this.config.tasks[name].pattern)
			.map(name => ({ name, task: this.config.tasks[name] }));

		// prepare the points to write+sample
		gl.points.outputPoints = [];

		const cramming = this.configData.cramming;

		const field = this.config.tasks.field;
		const boardBlockPositions = Array(200)
			.fill()
			.map((_, idx) => {
				const col = idx % 10;
				const row = Math.floor(idx / 10);
				const srcTL = {
					x: field.packing_pos.x + col * 8,
					y: field.packing_pos.y + row * 8,
				};
				const dst =
					idx < 100
						? {
								...cramming.block_pixels_1,
							}
						: {
								...cramming.block_pixels_2,
							};
				dst.x += idx % 100;

				return { srcTL, dst };
			});

		const previewPos = this.config.tasks.preview.packing_pos;

		const shinePositions = [
			...GpuTetrisOCR.previewBlockPositions.map((xy, idx) => ({
				srcTL: {
					x: xy[0] + previewPos.x,
					y: xy[1] + previewPos.y,
				},
				dst: {
					x: cramming.shine_pixels.x + idx,
					y: cramming.shine_pixels.y,
				},
			})),
		];

		if (this.config.tasks.cur_piece) {
			const curPiecePos = this.config.tasks.cur_piece.packing_pos;
			shinePositions.push(
				...GpuTetrisOCR.curPieceBlockPositions.map((xy, idx) => ({
					srcTL: {
						x: xy[0] + curPiecePos.x,
						y: xy[1] + curPiecePos.y,
					},
					dst: {
						x: cramming.shine_pixels.x + shinePositions.length + idx,
						y: cramming.shine_pixels.y,
					},
				}))
			);
		}
	}

	#initGpuAssets(frame) {
		this.#initGpuRenderAssets(frame);
		this.#initGpuComputeAssets(frame);
	}

	runPass1ToAtlas({ videoFrame, video }) {
		const glc = this.output_gl.ctx;

		glc.enable(gl.BLEND); // blending enabled for smooth resize

		glc.bindTexture(glc.TEXTURE_2D, gl.videoTex);
		glc.texImage2D(
			glc.TEXTURE_2D,
			0,
			glc.RGBA,
			glc.RGBA,
			glc.UNSIGNED_BYTE,
			videoFrame || video
		);
		glc.bindTexture(glc.TEXTURE_2D, null);

		glc.bindFramebuffer(glc.FRAMEBUFFER, gl.atlasFBO);
		glc.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		glc.clearColor(0.2, 0.2, 0.2, 1.0);
		glc.clear(glc.COLOR_BUFFER_BIT);

		glc.useProgram(gl.copyProg);

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
		glc.bindTexture(glc.TEXTURE_2D, gl.videoTex);
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
		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
	}

	pass2AtlasToCanvas() {
		const glc = gl.ctx;

		glc.disable(gl.BLEND);
		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
		glc.viewport(0, 0, this.output_canvas.width, this.output_canvas.height);
		glc.clearColor(0.2, 0.2, 0.2, 1);
		glc.clear(glc.COLOR_BUFFER_BIT);

		glc.useProgram(gl.copyProg);
		glc.uniform1i(gl.vars.uTex, 0);
		glc.uniform2i(
			gl.vars.uTexSize,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform2i(
			gl.vars.uOutSize,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform4i(
			gl.vars.uSrcPx,
			0,
			0,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform4i(
			gl.vars.uDstPx,
			0,
			0,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform1i(gl.vars.uMode, 0);
		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.bindSampler(0, gl.nearestSampler);
		glc.bindVertexArray(gl.vao);
		glc.drawArrays(glc.TRIANGLES, 0, 6);
		glc.bindVertexArray(null);
		glc.bindSampler(0, null);
	}

	pass3toFinalTexture() {
		const glc = gl.ctx;

		glc.disable(gl.BLEND);
		glc.bindFramebuffer(glc.FRAMEBUFFER, gl.finalFBO);
		glc.viewport(0, 0, FINAL_W, FINAL_H);
		glc.clearColor(0, 0, 0, 0);
		glc.clear(glc.COLOR_BUFFER_BIT);

		// 2a) Copy areas “as-is” from atlas => final
		glc.useProgram(gl.prog);
		glc.uniform1i(gl.vars.uTex, 0);
		glc.uniform2i(
			gl.vars.uTexSize,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform2i(
			gl.vars.uOutSize,
			this.configData.cramming.size.w,
			this.configData.cramming.size.h
		);
		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.bindVertexArray(gl.vao);

		this.digitFields.forEach(([name, task]) => {
			if (task.cramming_pos) {
				glc.uniform4i(
					gl.vars.uSrcPx,
					task.packing_pos.x,
					task.packing_pos.y,
					task.canvas.width,
					task.canvas.height
				);
				glc.uniform4i(
					gl.vars.uDstPx,
					task.cramming_pos.x,
					task.cramming_pos.y,
					task.canvas.width,
					task.canvas.height
				);
			} else if (name === 'T') {
				const digitSize = 14;
				const digitStride = 16;
				const cramPositions = this.configData.cramming.positions;
				// dirty, we KNOW that T needs special treatment to handle its 3 digits separatly T_T

				// D1
				glc.uniform4i(
					gl.vars.uSrcPx,
					task.packing_pos.x,
					task.packing_pos.y,
					digitSize,
					digitSize
				);
				glc.uniform4i(
					gl.vars.uDstPx,
					cramPositions.Td1.x,
					cramPositions.Td1.y,
					digitSize,
					digitSize
				);

				// D2
				glc.uniform4i(
					gl.vars.uSrcPx,
					task.packing_pos.x + digitStride,
					task.packing_pos.y,
					digitSize,
					digitSize
				);
				glc.uniform4i(
					gl.vars.uDstPx,
					cramPositions.Td2.x,
					cramPositions.Td2.y,
					digitSize,
					digitSize
				);

				// D3
				glc.uniform4i(
					gl.vars.uSrcPx,
					task.packing_pos.x + digitStride * 2,
					task.packing_pos.y,
					digitSize,
					digitSize
				);
				glc.uniform4i(
					gl.vars.uDstPx,
					cramPositions.Td3.x,
					cramPositions.Td3.y,
					digitSize,
					digitSize
				);
			}

			glc.uniform1i(gl.vars.uMode, 0);
			glc.drawArrays(glc.TRIANGLES, 0, 6);
		});

		// 2b) Computed pixels with points program
		glc.useProgram(gl.pointsProg);
		glc.uniform1i(gl.points.u.uAtlas, 0);
		glc.uniform2i(
			gl.points.u.uAtlasSize,
			this.output_canvas.width,
			this.output_canvas.height
		);
		glc.uniform2i(
			gl.points.u.uFinalSize,
			this.configData.cramming.size.w,
			this.configData.cramming.size.h
		);
		glc.activeTexture(glc.TEXTURE0);
		glc.bindTexture(glc.TEXTURE_2D, gl.atlasTex);
		glc.bindVertexArray(gl.points.vao);

		// Offsets you like (tune once, reuse)
		const OFFS = new Float32Array([
			0.5, 0.5, 0.25, 0.5, 0.75, 0.5, 0.5, 0.25, 0.5, 0.75, 0.25, 0.25, 0.75,
			0.25, 0.25, 0.75, 0.75, 0.75,
		]);
		glc.uniform1i(gl.points.u.uNumOffsets, OFFS.length / 2);
		glc.uniform2fv(gl.points.u.uOffsets, OFFS);

		// 34 shines: luma-only, put thresholded shine into alpha
		glc.uniform1f(
			gl.points.u.uShineThresh,
			GpuTetrisOCR.lumaThreshold255 / 255
		);
		glc.uniform1i(gl.points.u.uMode, 1);
		glc.drawArrays(glc.POINTS, OFF_SHINE, NUM_SHINE);

		// 3 refs: average color, alpha = 1
		glc.uniform1i(gl.points.u.uMode, 0);
		glc.drawArrays(glc.POINTS, OFF_REF, NUM_REF);

		// 200 blocks: average color, alpha = shine
		glc.uniform1i(gl.points.u.uMode, 2);
		glc.drawArrays(glc.POINTS, OFF_BLK, NUM_BLK);

		glc.bindVertexArray(null);
		glc.bindFramebuffer(glc.FRAMEBUFFER, null);
	}

	async processVideoFrame(frame) {
		if (!this.#ready) return;

		this.extractAndHighlightRegions(frame);
		this.runPass1ToAtlas(frame);
		this.pass2AtlasToCanvas(frame);
		this.pass3toFinalTexture(frame);

		const event = new CustomEvent('frame', {
			detail: {},
		});
		this.dispatchEvent(event);
	}
}
