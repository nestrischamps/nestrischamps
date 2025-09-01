import { TetrisOCR } from './TetrisOCR.js';

export class GpuTetrisOCR extends TetrisOCR {
	static TRANSFORM_TYPES = {
		NONE: 0,
		LUMA: 1,
		RED_LUMA: 2,
	};

	static previewBlockPositions = [
		// I
		[0, 4],
		[8, 4],
		[16, 4],
		[28, 4], // not top-left corner, but since I block are white, should work

		// Top Row - 3 blocks
		[4, 0],
		[12, 0],
		[20, 0],

		// Bottom Row - 3 blocks
		[4, 8],
		[12, 8],
		[20, 8],

		// O
		[8, 0],
		[16, 0],
		[8, 8],
		[16, 8],
	];

	static curPieceBlockPositions = [
		// I
		[0, 4],
		[6, 4],
		[12, 4],
		[20, 4], // not top-left corner, but since I block are white, should work

		// Top Row 1 - 3 blocks
		[2, 0],
		[8, 0],
		[14, 0],

		// Bottom Row 1 - 3 blocks
		[2, 6],
		[8, 6],
		[14, 6],

		// Top Row 2 - 3 blocks
		[2, 1],
		[8, 1],
		[14, 1],

		// Bottom Row 2 - 3 blocks
		[2, 7],
		[8, 7],
		[14, 7],

		// O
		[5, 1],
		[11, 1],
		[5, 7],
		[11, 7],
	];

	static lumaThreshold255 = 100;

	static getPreviewFromShines(shines) {
		// 14 shines represent possible block placements in the preview area
		// this replicates the logic from cpuTetrisOCR
		// Trying side i blocks
		const I = shines.subarray(0, 4);
		if (I[0] && I[3]) {
			return 'I';
		}

		// now trying the 3x2 matrix for T, L, J, S, Z
		const top_row = shines.subarray(4, 7);
		const bottom_row = shines.subarray(7, 10);

		if (top_row[0] && top_row[1] && top_row[2]) {
			// J, T, L
			if (bottom_row[0]) {
				return 'L';
			}
			if (bottom_row[1]) {
				return 'T';
			}
			if (bottom_row[2]) {
				return 'J';
			}

			return null;
		}

		if (top_row[1] && top_row[2]) {
			if (bottom_row[0] && bottom_row[1]) {
				return 'S';
			}
		}

		if (top_row[0] && top_row[1]) {
			if (bottom_row[1] && bottom_row[2]) {
				return 'Z';
			}
		}

		// lastly check for O
		const O = shines.subarray(10, 14);
		if (O[0] && O[1] && O[2] && O[3]) {
			return 'O';
		}

		return null;
	}

	static getCurPieceFromShines(shines) {
		// 20 shines represent possible block placements in the cur_piece area
		// this replicates the logic from cpuTetrisOCR
		// Trying side i blocks
		const I = shines.subarray(0, 4);
		if (I[0] && I[3]) {
			return 'I';
		}

		// now trying the 3x2 matrix for L, J
		const top_row_1 = shines.subarray(4, 7);
		const bottom_row_1 = shines.subarray(7, 10);

		if (top_row_1[0] && top_row_1[1] && top_row_1[2]) {
			// J, L
			if (bottom_row_1[0]) {
				return 'L';
			}
			if (bottom_row_1[2]) {
				return 'J';
			}
		}

		// now trying the 3x2 matrix for T, S, Z
		const top_row_2 = shines.subarray(10, 13);
		const bottom_row_2 = shines.subarray(13, 16);

		if (top_row_2[0] && top_row_2[1] && top_row_2[2]) {
			if (bottom_row_2[1]) {
				return 'T';
			}

			return null;
		}

		if (top_row_2[1] && top_row_2[2]) {
			if (bottom_row_2[0] && bottom_row_2[1]) {
				return 'S';
			}
		}

		if (top_row_2[0] && top_row_2[1]) {
			if (bottom_row_2[1] && bottom_row_2[2]) {
				return 'Z';
			}
		}

		// lastly check for O
		const O = shines.subarray(16, 20);
		if (O[0] && O[1] && O[2] && O[3]) {
			return 'O';
		}

		return null;
	}

	static async loadShaderSource(url) {
		return await fetch(url).then(res => res.text());
	}

	constructor(...args) {
		super(...args);
	}

	async loadDigitTemplates() {
		const digit_lumas = await TetrisOCR.loadDigitTemplates();

		this.digit_lumas_f32 = new Float32Array(
			digit_lumas.flatMap(typedArr => Array.from(typedArr)).map(v => v / 255)
		);
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
}
