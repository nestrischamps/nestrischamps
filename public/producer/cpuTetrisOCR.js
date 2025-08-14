import { TetrisOCR } from './TetrisOCR.js';
import { crop, luma } from '/ocr/image_tools.js';
import { PATTERN_MAX_INDEXES, SHINE_LUMA_THRESHOLD } from './constants.js';
import { rgb2lab, timingDecorator } from '/ocr/utils.js';

const PERF_METHODS = [
	// 'getSourceImageData',
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
];

export class CpuTetrisOCR extends TetrisOCR {
	constructor(stream, config) {
		super(stream, config);

		this.capture_ctx = this.capture_canvas.getContext('2d', {
			willReadFrequently: true,
		});

		this.output_ctx = this.output_canvas.getContext('2d', {
			willReadFrequently: true,
		});

		this.digit_img = new ImageData(14, 14);
		this.shine_img = new ImageData(2, 3);

		// decorate relevant methods to capture timings
		PERF_METHODS.forEach(name => {
			const method = this[name].bind(this);
			this[name] = timingDecorator(name, method);
		});
	}

	setConfig(config) {
		super.setConfig(config);

		for (const task of Object.values(this.all_tasks)) {
			task.canvas_ctx = task.canvas.getContext('2d', {
				willReadFrequently: true,
			});
		}
	}

	async processVideoFrame(videoFrame) {
		const { width, height } = this.capture_canvas;

		performance.mark(`start`);

		this.capture_ctx.filter = this.#getCanvasFilters();
		this.capture_ctx.drawImage(videoFrame || this.video, 0, 0, width, height);

		performance.mark(`draw`);

		// extract the regions of interes
		this.capture_ctx.filter = 'none';
		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			// 1. to the individual canvas
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

			// 2. to the packing output canvas
			this.output_ctx.drawImage(
				this.capture_canvas,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h,
				this.configData.packing.positions[name].x,
				this.configData.packing.positions[name].y,
				task.canvas.width,
				task.canvas.height
			);
		});

		performance.mark(`extract`);

		// draw the orange regions on the capture canvas
		this.capture_ctx.fillStyle = '#FFA50080';
		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			this.capture_ctx.fillRect(
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
		});

		performance.mark(`highlight`);

		// scan (i.e. ORC) all the regions
		const res = {
			score: this.scanScore(),
			level: this.scanLevel(),
			lines: this.scanLines(),
			preview: this.scanPreview(),
			field: this.scanField(),
		};

		if (this.config.tasks.color2) {
			res.color1 = this.scanColor1();
			res.color2 = this.scanColor2().map(v => Math.round(v));
			res.color3 = this.scanColor3().map(v => Math.round(v));
		}

		if (this.config.tasks.instant_das) {
			// assumes all 3 das tasks are a unit for the das trainer rom
			res.instant_das = this.scanInstantDas();
			res.cur_piece_das = this.scanCurPieceDas();
			res.cur_piece = this.scanCurPiece();
		}

		if (this.config.tasks.T) {
			Object.assign(res, this.scanPieceStats());
		}

		if (false && this.gym_pause_task) {
			res.gym_pause = this.scanGymPause();
		}

		performance.mark(`ocr`);

		performance.measure('draw', `start`, `draw`);
		performance.measure('extract', `draw`, `extract`);
		performance.measure('highlight', `extract`, `highlight`);
		performance.measure('ocr', `highlight`, `ocr`);

		return res;
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

	getDigit(pixel_data, max_check_index, is_red) {
		const sums = new Float64Array(max_check_index);
		const size = pixel_data.length >>> 2;
		const red_scale = 255 / 155; // scale red values as if capped at 155

		for (let p_idx = size; p_idx--; ) {
			const offset_idx = p_idx << 2;
			const pixel_luma = is_red
				? Math.min(pixel_data[offset_idx] * red_scale, 255) // only consider red component for luma, with scaling and capped
				: luma(
						pixel_data[offset_idx],
						pixel_data[offset_idx + 1],
						pixel_data[offset_idx + 2]
					);

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

	ocrDigits(task) {
		const digits = Array(task.pattern.length);
		const img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
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

	scanScore() {
		return this.ocrDigits(this.config.tasks.score);
	}

	scanLevel() {
		return this.ocrDigits(this.config.tasks.level);
	}

	scanLines() {
		return this.ocrDigits(this.config.tasks.lines);
	}

	scanColor2() {
		return this.scanColor(this.config.tasks.color2);
	}

	scanColor3() {
		return this.scanColor(this.config.tasks.color3);
	}

	scanInstantDas() {
		return this.ocrDigits(this.config.tasks.instant_das);
	}

	scanCurPieceDas() {
		return this.ocrDigits(this.config.tasks.cur_piece_das);
	}

	scanPieceStats() {
		return {
			T: this.ocrDigits(this.config.tasks.T),
			J: this.ocrDigits(this.config.tasks.J),
			Z: this.ocrDigits(this.config.tasks.Z),
			O: this.ocrDigits(this.config.tasks.O),
			S: this.ocrDigits(this.config.tasks.S),
			L: this.ocrDigits(this.config.tasks.L),
			I: this.ocrDigits(this.config.tasks.I),
		};
	}

	scanPreview() {
		const task = this.config.tasks.preview;
		const img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
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
		const img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
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

	scanColor1() {
		const task = this.config.tasks.color1;
		const img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
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

	scanColor(task) {
		const img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
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

	scanGymPause() {
		// Scanning the pause text scans the bottom of the letter 'U', "S", and "E" of the text "PAUSE"
		// that's because the bottom of the letters overlaps with block margins, which are black
		// When the pause text is not visible, luma on these overlap is expected to be very low
		// When pause text is visible, luma is expected to be high.

		const task = this.gym_pause_task;

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

	scanField() {
		// Note: We work in the square of colors domain
		// see: https://www.youtube.com/watch?v=LKnqECcg6Gw
		const task = this.config.tasks.field;
		const field_img = task.canvas_ctx.getImageData(
			0,
			0,
			task.canvas.width,
			task.canvas.height
		);

		// Make a memory efficient array for our needs
		const field = new Uint32Array(200);

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

				const has_shine = shine_pix_refs.some(([x, y]) => {
					const col_idx = block_offset + y * row_width * 4 + x * 4;
					const col = field_img.data.subarray(col_idx, col_idx + 3);

					return luma(...col) > SHINE_LUMA_THRESHOLD;
				});

				if (!has_shine) {
					field[ridx * 10 + cidx] = 0; // we have black for sure!
					continue;
				}

				const channels = pix_refs
					.map(([x, y]) => {
						const col_idx = block_offset + y * row_width * 4 + x * 4;
						return field_img.data.subarray(col_idx, col_idx + 3);
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

				field[ridx * 10 + cidx] =
					(channels[0] << 24) | (channels[1] << 16) | (channels[2] << 8) | 0xff; // ff for fully opaque
			}
		}

		return field;
	}
}
