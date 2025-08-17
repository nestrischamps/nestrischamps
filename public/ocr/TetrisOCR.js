import { timingDecorator } from '/ocr/utils.js';
import { bicubic, crop, luma } from '/ocr/image_tools.js';
import { rgb2lab } from '/ocr/utils.js';

const PATTERN_MAX_INDEXES = {
	B: 3, // null, 0, 1 (Binary)
	T: 4, // null, 0, 1, 2 (Ternary)
	Q: 6, // null, 0, 1, 2, 3, 4 (Quintic)
	D: 11, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 (Digits)
	L: 13, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, A, B (Level)
	A: 17, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, A, B, C, D, E, F (Alphanums)
};

const PERF_METHODS = [
	'getSourceImageData',
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

const DEFAULT_COLOR_0 = [0x00, 0x00, 0x00];
const DEFAULT_COLOR_1 = [0xf0, 0xf0, 0xf0];

function getDigitsWidth(n) {
	// width per digit is 8px times 2
	// and for last digit, we ignore the 1px (times 2)
	// border on the right, hence -2
	return 16 * n - 2;
}

// Resize areas based on logical NES pixels (2x for digits)
const TASK_RESIZE = {
	score: [getDigitsWidth(6), 14],
	score7: [getDigitsWidth(7), 14],
	level: [getDigitsWidth(2), 14],
	lines: [getDigitsWidth(3), 14],
	field: [79, 159],
	preview: [31, 15],
	cur_piece: [23, 12],
	instant_das: [getDigitsWidth(2), 14],
	cur_piece_das: [getDigitsWidth(2), 14],
	color1: [5, 5],
	color2: [5, 5],
	color3: [5, 5],
	stats: [getDigitsWidth(3), 14 * 7 + 14 * 7], // height captures all the individual stats...
	piece_count: [getDigitsWidth(3), 14],
	gym_pause: [22, 1],
};

// Not supplied as user control, because Gym Pause is 100% connected to the calibration of the field
// then again... We coud argue everything *should* be 100% connected to the calibration of the field,
// so... is it really wise to not allow user-controlled fine-tuning? That plus being an internal process, we
// are not able to show what we are capturing for the gym pause
const GYM_PAUSE_CROP_RELATIVE_TO_FIELD = [37, 47, 22, 1];

const SHINE_LUMA_THRESHOLD = 75; // Since shine is white, should this threshold be higher?
const GYM_PAUSE_LUMA_THRESHOLD = 75;

export default class TetrisOCR extends EventTarget {
	constructor(templates, palettes, config) {
		super();

		this.templates = templates;
		this.palettes = palettes;
		this.setConfig(config);

		this.digit_img = new ImageData(14, 14); // 2x for better matching
		this.shine_img = new ImageData(2, 3);

		// decorate relevant methods to capture timings
		PERF_METHODS.forEach(name => {
			const method = this[name].bind(this);
			this[name] = timingDecorator(name, method);
		});
	}

	/*
	 * processConfig()
	 * 1. Calculate the overal crop area based on the individual task crop areas
	 * 2. Instantiate ImageData objects for each cropped and resize job, so they can:
	 *    a. be reused without memory allocation
	 *    b. be shared via the config reference with client app (say for display of the areas)
	 *
	 */
	setConfig(config) {
		this.config = config;
		this.palette = this.palettes?.[config.palette]; // will reset to undefined when needed

		this.pending_capture_reinit = true;
		this.fixPalette();

		const bounds = {
			top: 0xffffffff,
			left: 0xffffffff,
			bottom: -1,
			right: -1,
		};

		const all_tasks = { ...this.config.tasks };

		if (!this.config.tasks.instant_das) {
			const field_crop = this.config.tasks.field.crop;

			const scaleX = field_crop[2] / TASK_RESIZE.field[0];
			const scaleY = field_crop[3] / TASK_RESIZE.field[1];

			// we compute the gym_pause crop in relation to the field
			const gym_pause_crop_coordinates = [
				Math.round(
					field_crop[0] + GYM_PAUSE_CROP_RELATIVE_TO_FIELD[0] * scaleX
				),
				Math.round(
					field_crop[1] + GYM_PAUSE_CROP_RELATIVE_TO_FIELD[1] * scaleY
				),
				Math.round(GYM_PAUSE_CROP_RELATIVE_TO_FIELD[2] * scaleX),
				Math.round(GYM_PAUSE_CROP_RELATIVE_TO_FIELD[3] * scaleY),
			];

			// Safety check on capture area size (zero size is not acceptable)
			if (
				gym_pause_crop_coordinates[2] <= 0 ||
				gym_pause_crop_coordinates[3] <= 0
			) {
				this.gym_pause_task = null;
				console.warn(
					`Unexpected zero-size gym crop coordinates [${gym_pause_crop_coordinates}] ` +
						`(in relation to field crop coordinates [${field_crop}] - with scale factors ${scaleX}x${scaleY}). ` +
						`Gym Pause scanning is disabled.`
				);
			} else {
				this.gym_pause_task = { crop: gym_pause_crop_coordinates };
				all_tasks.gym_pause = this.gym_pause_task;
			}
		}

		// Note: This create a lot of imageData objects of similar sizes
		// Some could be shared because they are the same dimensions (e.g. 3 digits for lines, and piece stats)
		// but if we share them, we would not be able to display them individually in the debug UI
		for (const [name, task] of Object.entries(all_tasks)) {
			if (this.palette && name.startsWith('color')) continue;

			const {
				crop: [x, y, w, h],
			} = task;

			bounds.top = Math.min(bounds.top, y);
			bounds.left = Math.min(bounds.left, x);
			bounds.bottom = Math.max(bounds.bottom, y + h);
			bounds.right = Math.max(bounds.right, x + w);

			let resize_tuple;

			if (name.length === 1) {
				resize_tuple = TASK_RESIZE.piece_count;
			} else if (name === 'score' && config.score7) {
				resize_tuple = TASK_RESIZE.score7;
			} else {
				resize_tuple = TASK_RESIZE[name];
			}

			task.crop_img = new ImageData(w, h);
			task.scale_img = new ImageData(...resize_tuple);
		}

		this.config.capture_bounds = bounds;
		this.config.capture_area = {
			x: bounds.left,
			y: bounds.top,
			w: bounds.right - bounds.left,
			h: bounds.bottom - bounds.top,
		};

		this.updateCaptureContextFilters();
	}

	fixPalette() {
		if (!this.palette) return;

		this.palette = this.palette.map(colors => {
			if (colors.length == 2) {
				return [DEFAULT_COLOR_1, colors[0], colors[1]];
			}

			return colors;
		});
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
				const diff = pixel_luma - this.templates[t_idx][p_idx];
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

	updateCaptureContextFilters() {
		if (!this.capture_canvas_ctx) return;
		if (!this.config) return;

		const filters = [];

		if (this.config.brightness && this.config.brightness > 1) {
			filters.push(`brightness(${this.config.brightness})`);
		}

		if (this.config.contrast && this.config.contrast !== 1) {
			filters.push(`contrast(${this.config.contrast})`);
		}

		if (filters.length) {
			this.capture_canvas_ctx.filter = filters.join(' ');
		} else {
			this.capture_canvas_ctx.filter = 'none';
		}
	}

	initCaptureContext(frame) {
		this.pending_capture_reinit = false;
		this.capture_canvas = document.createElement('canvas');

		this.capture_canvas.width = frame.width;
		this.capture_canvas.height =
			frame.height >> (this.config.use_half_height ? 1 : 0);

		this.capture_canvas_ctx = this.capture_canvas.getContext('2d', {
			alpha: false,
			willReadFrequently: true,
		});
		this.capture_canvas_ctx.imageSmoothingEnabled = false;

		// On top of the capture context, we need one more canvas for the scaled field
		// because the performance of OffScreenCanvas are horrible, and same gvoes for the bicubic lib for any image that's not super small :(

		// TODO: get rid of this additional canvas when we can T_T
		this.scaled_field_canvas = document.createElement('canvas');

		this.scaled_field_canvas.width = TASK_RESIZE.field[0];
		this.scaled_field_canvas.height = TASK_RESIZE.field[1];

		this.scaled_field_canvas_ctx = this.scaled_field_canvas.getContext('2d', {
			alpha: false,
			willReadFrequently: true,
		});
		this.scaled_field_canvas_ctx.imageSmoothingEnabled = true;
		this.scaled_field_canvas_ctx.imageSmoothingQuality = 'medium';

		this.updateCaptureContextFilters();
	}

	processsFrameStep1(frame) {
		if (!this.capture_canvas_ctx || this.pending_capture_reinit) {
			this.initCaptureContext(frame);
		}

		performance.mark('start');
		this.capture_canvas_ctx.drawImage(
			frame,
			0,
			0,
			frame.width,
			frame.height >> (this.config.use_half_height ? 1 : 0)
		);
		performance.mark('draw_end');
		performance.measure('draw_frame', 'start', 'draw_end');

		const source_img = this.getSourceImageData();

		const res = {
			source_img,
			score: this.scanScore(source_img),
			level: this.scanLevel(source_img),
			lines: this.scanLines(source_img),
			preview: this.scanPreview(source_img),
		};

		if (this.config.tasks.instant_das) {
			// assumes all 3 das tasks are a unit for the das trainer rom
			res.instant_das = this.scanInstantDas(source_img);
			res.cur_piece_das = this.scanCurPieceDas(source_img);
			res.cur_piece = this.scanCurPiece(source_img);
		}

		if (this.config.tasks.T) {
			Object.assign(res, this.scanPieceStats(source_img));
		}

		if (this.gym_pause_task) {
			res.gym_pause = this.scanGymPause(source_img);
		}

		return res;
	}

	async processsFrameStep2(partial_frame, level) {
		const res = {};
		const level_units = level % 10;

		// color are either supplied from palette or read, there's no other choice
		if (this.palette) {
			[res.color1, res.color2, res.color3] = this.palette[level_units];
		} else {
			// assume tasks color1 and color2 are set
			res.color2 = this.scanColor2(partial_frame.source_img);
			res.color3 = this.scanColor3(partial_frame.source_img);

			if (this.config.tasks.color1) {
				res.color1 = this.scanColor1(partial_frame.source_img);
			} else {
				res.color1 = DEFAULT_COLOR_1;
			}
		}

		const colors = [res.color1, res.color2, res.color3];

		if (this.config.handle_retron_levels_6_7 === false) {
			// undefined defaults to true; only explicit false is considered
			colors.unshift(DEFAULT_COLOR_0); // always add black as a color to compare to
		} else if (level_units != 6 && level_units != 7) {
			// INFO: colors for level X6 and X7 are terrible on Retron, so we don't add black to ensure they don't get mixed up
			// When we use a palette
			// TOCHECK: is this still needed now that we work in lab color space?
			// NOTE: this conditional branch could be merged into the one above with an OR check, but it would make the code less readable
			colors.unshift(DEFAULT_COLOR_0); // add black
		}

		res.field = await this.scanField(partial_frame.source_img, colors);

		// round the colors if needed
		if (res.color2) {
			res.color2 = res.color2.map(v => Math.round(v));
			res.color3 = res.color3.map(v => Math.round(v));
		}

		return res;
	}

	scanScore(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.score);
	}

	scanLevel(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.level);
	}

	scanLines(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.lines);
	}

	scanColor2(source_img) {
		return this.scanColor(source_img, this.config.tasks.color2);
	}

	scanColor3(source_img) {
		return this.scanColor(source_img, this.config.tasks.color3);
	}

	scanInstantDas(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.instant_das);
	}

	scanCurPieceDas(source_img) {
		return this.ocrDigits(source_img, this.config.tasks.cur_piece_das);
	}

	scanPieceStats(source_img) {
		return {
			T: this.ocrDigits(source_img, this.config.tasks.T),
			J: this.ocrDigits(source_img, this.config.tasks.J),
			Z: this.ocrDigits(source_img, this.config.tasks.Z),
			O: this.ocrDigits(source_img, this.config.tasks.O),
			S: this.ocrDigits(source_img, this.config.tasks.S),
			L: this.ocrDigits(source_img, this.config.tasks.L),
			I: this.ocrDigits(source_img, this.config.tasks.I),
		};
	}

	getSourceImageData() {
		const pixels = this.capture_canvas_ctx.getImageData(
			this.config.capture_area.x,
			this.config.capture_area.y,
			this.config.capture_area.w,
			this.config.capture_area.h
		);

		/*
	const pixels_per_rows = this.config.capture_area.w * 4;
	const max_rows = this.config.capture_bounds.bottom;

	for (let row_idx = 1; row_idx < max_rows; row_idx++) {
		pixels.data.copyWithin(
			pixels_per_rows * row_idx,
			pixels_per_rows * row_idx * 2,
			pixels_per_rows * (row_idx * 2 + 1)
		);
	}
	/**/

		this.config.source_img = pixels;

		return pixels;
	}

	getCropCoordinates(task) {
		const [raw_x, raw_y, w, h] = task.crop;

		return [
			raw_x - this.config.capture_area.x,
			raw_y - this.config.capture_area.y,
			w,
			h,
		];
	}

	ocrDigits(source_img, task) {
		const [x, y, w, h] = this.getCropCoordinates(task);
		const digits = Array(task.pattern.length);

		crop(source_img, x, y, w, h, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

		for (let idx = digits.length; idx--; ) {
			const char = task.pattern[idx];

			crop(task.scale_img, idx * 16, 0, 14, 14, this.digit_img);

			const digit = this.getDigit(
				this.digit_img.data,
				PATTERN_MAX_INDEXES[char],
				task.red
			);

			if (!digit) return null;

			digits[idx] = digit - 1;
		}

		return digits;
	}

	/*
	 * Returns true if at least one of the pixel has a luma higher than threshold
	 */
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

	scanPreview(source_img) {
		const task = this.config.tasks.preview;
		const [x, y, w, h] = this.getCropCoordinates(task);

		crop(source_img, x, y, w, h, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

		// Trying side i blocks
		if (
			this.hasShine(task.scale_img, 0, 4) &&
			this.hasShine(task.scale_img, 28, 4) // not top-left corner, but since I block are white, should work
		) {
			return 'I';
		}

		// now trying the 3x2 matrix for T, L, J, S, Z
		const top_row = [
			this.hasShine(task.scale_img, 4, 0),
			this.hasShine(task.scale_img, 12, 0),
			this.hasShine(task.scale_img, 20, 0),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			// J, T, L
			if (this.hasShine(task.scale_img, 4, 8)) {
				return 'L';
			}
			if (this.hasShine(task.scale_img, 12, 8)) {
				return 'T';
			}
			if (this.hasShine(task.scale_img, 20, 8)) {
				return 'J';
			}

			return null;
		}

		if (top_row[1] && top_row[2]) {
			if (
				this.hasShine(task.scale_img, 4, 8) &&
				this.hasShine(task.scale_img, 12, 8)
			) {
				return 'S';
			}
		}

		if (top_row[0] && top_row[1]) {
			if (
				this.hasShine(task.scale_img, 12, 8) &&
				this.hasShine(task.scale_img, 20, 8)
			) {
				return 'Z';
			}
		}

		// lastly check for O
		if (
			this.hasShine(task.scale_img, 8, 0) &&
			this.hasShine(task.scale_img, 16, 0) &&
			this.hasShine(task.scale_img, 8, 8) &&
			this.hasShine(task.scale_img, 16, 8)
		) {
			return 'O';
		}

		return null;
	}

	scanCurPiece(source_img) {
		const task = this.config.tasks.cur_piece;
		const [x, y, w, h] = this.getCropCoordinates(task);

		// curPieces are not vertically aligned on the top row
		// L and J are rendered 1 pixel higher than S, Z, T, O

		crop(source_img, x, y, w, h, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

		// Trying side i blocks
		if (
			this.hasShine(task.scale_img, 0, 4) &&
			this.hasShine(task.scale_img, 20, 4)
		) {
			return 'I';
		}

		// now trying for L, J (top pixel alignment)
		let top_row = [
			this.hasShine(task.scale_img, 2, 0),
			this.hasShine(task.scale_img, 8, 0),
			this.hasShine(task.scale_img, 14, 0),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			if (this.hasShine(task.scale_img, 2, 6)) {
				return 'L';
			}
			if (this.hasShine(task.scale_img, 14, 6)) {
				return 'J';
			}
		}

		// checking S, Z, T
		top_row = [
			this.hasShine(task.scale_img, 2, 1),
			this.hasShine(task.scale_img, 8, 1),
			this.hasShine(task.scale_img, 14, 1),
		];

		if (top_row[0] && top_row[1] && top_row[2]) {
			if (this.hasShine(task.scale_img, 8, 7)) {
				return 'T';
			}

			return null;
		}

		if (top_row[1] && top_row[2]) {
			if (
				this.hasShine(task.scale_img, 2, 7) &&
				this.hasShine(task.scale_img, 8, 7)
			) {
				return 'S';
			}
		}

		if (top_row[0] && top_row[1]) {
			if (
				this.hasShine(task.scale_img, 8, 7) &&
				this.hasShine(task.scale_img, 14, 7)
			) {
				return 'Z';
			}
		}

		// lastly check for O
		if (
			this.hasShine(task.scale_img, 5, 1) &&
			this.hasShine(task.scale_img, 11, 1) &&
			this.hasShine(task.scale_img, 5, 7) &&
			this.hasShine(task.scale_img, 11, 7)
		) {
			return 'O';
		}

		return null;
	}

	scanColor1(source_img) {
		const task = this.config.tasks.color1;
		const xywh_coordinates = this.getCropCoordinates(task);

		crop(source_img, ...xywh_coordinates, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

		// I tried selecting the pixel with highest luma but that didn't work.
		// On capture cards with heavy color bleeding, it's inaccurate.

		// we select the brightest pixel in the center 3x3 square of the
		const row_width = task.scale_img.width;

		let composite_white = [0, 0, 0];

		// we check luma pixels on the inside only
		for (let y = task.scale_img.height - 1; --y; ) {
			for (let x = task.scale_img.width - 1; --x; ) {
				const pix_offset = (y * row_width + x) << 2;
				const cur_color = task.scale_img.data.subarray(
					pix_offset,
					pix_offset + 3
				);

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

	scanColor(source_img, task) {
		// to get the average color, we take the average of squares, or it might be too dark
		// see: https://www.youtube.com/watch?v=LKnqECcg6Gw

		const xywh_coordinates = this.getCropCoordinates(task);

		crop(source_img, ...xywh_coordinates, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

		const row_width = task.scale_img.width;
		const pix_refs = [
			[3, 2],
			[3, 3],
			[2, 3],
		];

		return pix_refs
			.map(([x, y]) => {
				const col_idx = (y * row_width + x) << 2;
				return task.scale_img.data.subarray(col_idx, col_idx + 3);
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

	scanGymPause(source_img) {
		// Scanning the pause text scans the bottom of the letter 'U', "S", and "E" of the text "PAUSE"
		// that's because the bottom of the letters overlaps with block margins, which are black
		// When the pause text is not visible, luma on these overlap is expected to be very low
		// When pause text is visible, luma is expected to be high.

		const task = this.gym_pause_task;
		const xywh_coordinates = this.getCropCoordinates(task);

		crop(source_img, ...xywh_coordinates, task.crop_img);
		bicubic(task.crop_img, task.scale_img);

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
				return luma(...task.scale_img.data.subarray(col_idx, col_idx + 3));
			})
			.reduce((acc, luma) => acc + luma, 0);

		const avg_luma = total_luma / pix_refs.length;

		return [Math.round(avg_luma), avg_luma > GYM_PAUSE_LUMA_THRESHOLD];
	}

	async scanField(source_img, _colors) {
		// Note: We work in the square of colors domain
		// see: https://www.youtube.com/watch?v=LKnqECcg6Gw
		const task = this.config.tasks.field;
		const xywh_coordinates = this.getCropCoordinates(task);
		const colors = _colors.map(rgb2lab); // we operate in Lab color space
		const index_offset = _colors.length == 4 ? 0 : 1; // length of colors is either 3 or 4

		// crop is not needed, but done anyway to share task captured area with caller app
		crop(source_img, ...xywh_coordinates, task.crop_img);

		/*
	// the 2 lines below show what's actually needed: a simple crop and scale on the source image
	// but cubic scaling in JS is MUCH slower than with native code, so we use canvas instead
	bicubic(task.crop_img, task.scale_img);
	const field_img = task.scale_img;
	/**/

		/**/
		// crop and scale with canva
		const original_field_img = await createImageBitmap(
			source_img,
			...xywh_coordinates
		);

		this.scaled_field_canvas_ctx.drawImage(
			original_field_img,
			0,
			0,
			...TASK_RESIZE.field
		);

		const field_img = this.scaled_field_canvas_ctx.getImageData(
			0,
			0,
			...TASK_RESIZE.field
		);

		// writing into scale_img is not needed, but done anyway to share area with caller app
		task.scale_img.data.set(field_img.data);
		/**/

		// Make a memory efficient array for our needs
		const field = new Uint8Array(200);

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

				const channels = rgb2lab(
					pix_refs
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
						.map(v => Math.sqrt(v / pix_refs.length))
				);

				let min_diff = 0xffffffff;
				let min_idx = -1;

				colors.forEach((col, col_idx) => {
					const sum = col.reduce(
						(acc, c, idx) => acc + (c - channels[idx]) * (c - channels[idx]),
						0
					);

					if (sum < min_diff) {
						min_diff = sum;
						min_idx = col_idx;
					}
				});

				field[ridx * 10 + cidx] = min_idx + index_offset;
			}
		}
		/**/

		return field;
	}
}
