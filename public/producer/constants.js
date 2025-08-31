const GAME_TYPE = {
	MINIMAL: 0,
	CLASSIC: 1,
	DAS_TRAINER: 2,
};

export const PATTERN_MAX_INDEXES = {
	B: 3, // null, 0, 1 (Binary)
	T: 4, // null, 0, 1, 2 (Ternary)
	Q: 6, // null, 0, 1, 2, 3, 4 (Quintic)
	D: 11, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 (Digits)
	L: 13, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, A, B (Level)
	A: 17, // null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, A, B, C, D, E, F (Alphanums)
};

export const GYM_PAUSE_LUMA_THRESHOLD = 75;
export const SHINE_LUMA_THRESHOLD = 75; // Since shine is white, should this threshold be higher?

export const REFERENCE_SIZE = { w: 512, h: 448 };
export const REFERENCE_LOCATIONS = {
	score: {
		crop: { x: 384, y: 112, w: 94, h: 14 },
		pattern: 'ADDDDD',
		luma: true,
	},
	score7: {
		crop: { x: 384, y: 112, w: 110, h: 14 },
		pattern: 'DDDDDDD',
		luma: true,
	},
	level: { crop: { x: 416, y: 320, w: 30, h: 14 }, pattern: 'TD', luma: true }, // TD, because we only care about start level, which is 29 or lower
	lines: { crop: { x: 304, y: 32, w: 46, h: 14 }, pattern: 'QDD', luma: true },
	field_w_borders: { crop: { x: 190, y: 78, w: 162, h: 324 } },
	field: { crop: { x: 192, y: 80, w: 158, h: 318 } },
	preview: { crop: { x: 384, y: 224, w: 62, h: 30 }, luma: true },
	color1: { crop: { x: 76, y: 170, w: 10, h: 10 } },
	color2: { crop: { x: 76, y: 212, w: 10, h: 10 } },
	color3: { crop: { x: 76, y: 246, w: 10, h: 10 } },
	instant_das: {
		crop: { x: 80, y: 64, w: 30, h: 14 },
		pattern: 'BD',
		luma: true,
	},
	cur_piece_das: {
		crop: { x: 112, y: 96, w: 30, h: 14 },
		pattern: 'BD',
		luma: true,
	},
	cur_piece: { crop: { x: 30, y: 89, w: 45, h: 23 } },
	T: { crop: { x: 96, y: 176, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	J: { crop: { x: 96, y: 208, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	Z: { crop: { x: 96, y: 240, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	O: { crop: { x: 96, y: 272, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	S: { crop: { x: 96, y: 304, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	L: { crop: { x: 96, y: 336, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
	I: { crop: { x: 96, y: 368, w: 46, h: 14 }, pattern: 'BDD', red_luma: true },
};

export const DEFAULT_COLOR_0 = [0x00, 0x00, 0x00];
export const DEFAULT_COLOR_1 = [0xf0, 0xf0, 0xf0];

export function getDigitsWidth(n) {
	// width per digit is 8px times 2
	// and for last digit, we ignore the 1px (times 2)
	// border on the right, hence -2
	return 16 * n - 2;
}

const piece_counter = { w: getDigitsWidth(3), h: 14 };

export const TASK_RESIZE = {
	score: { w: getDigitsWidth(6), h: 14 },
	score7: { w: getDigitsWidth(7), h: 14 },
	level: { w: getDigitsWidth(2), h: 14 },
	lines: { w: getDigitsWidth(3), h: 14 },
	field: { w: 79, h: 159 },
	preview: { w: 31, h: 15 },
	cur_piece: { w: 23, h: 12 },
	instant_das: { w: getDigitsWidth(2), h: 14 },
	cur_piece_das: { w: getDigitsWidth(2), h: 14 },
	color1: { w: 5, h: 5 },
	color2: { w: 5, h: 5 },
	color3: { w: 5, h: 5 },
	stats: { w: getDigitsWidth(3), h: 14 * 7 + 14 * 7 },
	T: { ...piece_counter },
	J: { ...piece_counter },
	Z: { ...piece_counter },
	O: { ...piece_counter },
	S: { ...piece_counter },
	L: { ...piece_counter },
	I: { ...piece_counter },
	gym_pause: { w: 22, h: 1 },
};

export const GYM_PAUSE_CROP_RELATIVE_TO_FIELD = { x: 37, y: 47, w: 22, h: 1 };

export const CONFIGS = {
	classic: {
		game_type: GAME_TYPE.CLASSIC,
		reference: '/ocr/reference_ui_classic.png',
		fields: [
			'score',
			'level',
			'lines',
			'field',
			'preview',
			'color1',
			'color2',
			'color3',
			'T',
			'J',
			'Z',
			'O',
			'S',
			'L',
			'I',
		],
		packing: {
			size: { w: getDigitsWidth(7), h: 256 },
			positions: {
				score: { x: 0, y: 0 },
				lines: { x: 0, y: 16 },
				level: { x: 48, y: 16 },
				preview: { x: 0, y: 32 },

				color1: { x: 32, y: 32 },
				color2: { x: 32, y: 37 },
				color3: { x: 32, y: 42 },

				T: { x: 48, y: 32 },
				J: { x: 0, y: 48 },
				Z: { x: 48, y: 48 },
				O: { x: 0, y: 64 },
				S: { x: 48, y: 64 },
				L: { x: 0, y: 80 },
				I: { x: 48, y: 80 },

				field: { x: 0, y: 96 },
			},
		},
	},
	das_trainer: {
		game_type: GAME_TYPE.DAS_TRAINER,
		reference: '/ocr/reference_ui_das_trainer.png',
		palette: 'easiercap',
		fields: [
			'score',
			'level',
			'lines',
			'field',
			'preview',
			'instant_das',
			'cur_piece_das',
			'cur_piece',
		],
		packing: {
			size: { w: getDigitsWidth(7), h: 208 },
			positions: {
				score: { x: 0, y: 0 },
				lines: { x: 0, y: 16 },
				level: { x: 48, y: 16 },
				preview: { x: 0, y: 32 },

				instant_das: { x: 32, y: 32 },
				cur_piece_das: { x: 64, y: 32 },
				cur_piece: { x: 80, y: 16 },

				field: { x: 0, y: 48 },
			},
		},
	},
	minimal: {
		game_type: GAME_TYPE.MINIMAL,
		reference: '/ocr/reference_ui_classic.png',
		palette: 'easiercap',
		fields: ['score', 'level', 'lines', 'field', 'preview'],
		packing: {
			size: { w: getDigitsWidth(7), h: 192 },
			positions: {
				score: { x: 0, y: 0 },
				lines: { x: 0, y: 16 },
				level: { x: 48, y: 16 },
				preview: { x: 79, y: 16 },
				field: { x: 0, y: 32 },
			},
		},
	},
};

export const RETRON_HD_CONFIG = {
	169: {
		classic: {
			score: { crop: { x: 954, y: 188, w: 230, h: 21 } },
			level: { crop: { x: 1033, y: 500, w: 72, h: 21 } },
			lines: { crop: { x: 757, y: 68, w: 112, h: 21 } },
			field: { crop: { x: 481, y: 140, w: 388, h: 477 } },
			preview: { crop: { x: 953, y: 356, w: 153, h: 45 } },
			color1: { crop: { x: 195, y: 275, w: 24, h: 15 } },
			color2: { crop: { x: 195, y: 338, w: 24, h: 15 } },
			color3: { crop: { x: 195, y: 389, w: 24, h: 15 } },
			T: { crop: { x: 245, y: 284, w: 112, h: 21 } },
			J: { crop: { x: 245, y: 332, w: 112, h: 21 } },
			Z: { crop: { x: 245, y: 380, w: 112, h: 21 } },
			O: { crop: { x: 245, y: 428, w: 112, h: 21 } },
			S: { crop: { x: 245, y: 476, w: 112, h: 21 } },
			L: { crop: { x: 245, y: 524, w: 112, h: 21 } },
			I: { crop: { x: 245, y: 572, w: 112, h: 21 } },
		},
		minimal: {
			score: { crop: { x: 954, y: 188, w: 230, h: 21 } },
			level: { crop: { x: 1033, y: 500, w: 72, h: 21 } },
			lines: { crop: { x: 757, y: 68, w: 112, h: 21 } },
			field: { crop: { x: 481, y: 140, w: 388, h: 477 } },
			preview: { crop: { x: 953, y: 356, w: 153, h: 45 } },
		},
	},
	43: {
		classic: {
			score: { crop: { x: 862, y: 188, w: 163, h: 21 } },
			level: { crop: { x: 917, y: 500, w: 52, h: 21 } },
			lines: { crop: { x: 722, y: 68, w: 80, h: 21 } },
			field: { crop: { x: 527, y: 140, w: 275, h: 477 } },
			preview: { crop: { x: 861, y: 356, w: 109, h: 45 } },
			color1: { crop: { x: 326, y: 275, w: 17, h: 15 } },
			color2: { crop: { x: 326, y: 338, w: 17, h: 15 } },
			color3: { crop: { x: 326, y: 389, w: 17, h: 15 } },
			T: { crop: { x: 361, y: 284, w: 80, h: 21 } },
			J: { crop: { x: 361, y: 332, w: 80, h: 21 } },
			Z: { crop: { x: 361, y: 380, w: 80, h: 21 } },
			O: { crop: { x: 361, y: 428, w: 80, h: 21 } },
			S: { crop: { x: 361, y: 476, w: 80, h: 21 } },
			L: { crop: { x: 361, y: 524, w: 80, h: 21 } },
			I: { crop: { x: 361, y: 572, w: 80, h: 21 } },
		},
		minimal: {
			score: { crop: { x: 862, y: 188, w: 163, h: 21 } },
			level: { crop: { x: 917, y: 500, w: 52, h: 21 } },
			lines: { crop: { x: 722, y: 68, w: 80, h: 21 } },
			field: { crop: { x: 527, y: 140, w: 275, h: 477 } },
			preview: { crop: { x: 861, y: 356, w: 109, h: 45 } },
		},
	},
};
