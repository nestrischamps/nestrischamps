export { peerServerOptions } from '/js/peerjsOptions.js';

export const DOM_DEV_NULL =
	(typeof document !== 'undefined' && document.createElement('div')) || {};

export const PIECES = ['T', 'J', 'Z', 'O', 'S', 'L', 'I'];

// generate colors at https://paletton.com/
export const LINES = {
	1: { name: 'singles', color: '#1678FF' },
	2: { name: 'doubles', color: '#FF9F00' },
	3: { name: 'triples', color: '#FF00B9' },
	4: { name: 'tetris', color: '#FFFFFF' },
};

export const BOARD_COLORS = {
	floor: '#747474',
	height: '#747474', // BBBBBB',
	tetris_ready: '#9F5DC3',
	clean_slope: '#53BAB2',
	double_well: '#F8F81B',
	drought: 'orange',
};

export const DAS_COLORS = {
	absent: 'white',
	great: 'limegreen',
	ok: 'orange',
	bad: 'red',
};

export const DAS_THRESHOLDS = {
	0: 'bad',
	1: 'bad',
	2: 'bad',
	3: 'bad',
	4: 'bad',
	5: 'bad',
	6: 'bad',
	7: 'bad',
	8: 'bad',
	9: 'bad',
	10: 'ok',
	11: 'ok',
	12: 'ok',
	13: 'ok',
	14: 'ok',
	15: 'great',
	16: 'great',
};

export const DROUGHT_PANIC_THRESHOLD = 13;
export const EFF_LINE_VALUES = [0, 40, 50, 100, 300];
export const SCORE_BASES = [0, 40, 100, 300, 1200]; // equivalent to EFF_LINE_VALUES.map((v, i) => v * i)

export const CLEAR_ANIMATION_NUM_FRAMES = 7;

// arrays of color 1 and color 2
export const LEVEL_COLORS = [
	['#4A32FF', '#4AAFFE'],
	['#009600', '#6ADC00'],
	['#B000D4', '#FF56FF'],
	['#4A32FF', '#00E900'],
	['#C8007F', '#00E678'],
	['#00E678', '#968DFF'],
	['#C41E0E', '#666666'],
	['#8200FF', '#780041'],
	['#4A32FF', '#C41E0E'],
	['#C41E0E', '#F69B00'],
];

export const TRANSITIONS = {
	0: 10,
	1: 20,
	2: 30,
	3: 40,
	4: 50,
	5: 60,
	6: 70,
	7: 80,
	8: 90,
	9: 100,
	10: 100,
	11: 100,
	12: 100,
	13: 100,
	14: 100,
	15: 100,
	16: 110,
	17: 120,
	18: 130,
	19: 140,
	20: 150,
	21: 160,
	22: 170,
	23: 180,
	24: 190,
	25: 200,
	26: 200,
	27: 200,
	28: 200,
	29: 200,
};

export const PIECE_COLORS = {
	T: 1,
	J: 2,
	Z: 3,
	O: 1,
	S: 2,
	L: 3,
	I: 1,
};

export const RUNWAY = {
	TRANSITION: 'TRANSITION',
	LV19: 'LV19',
	LV29: 'LV29',
	LV39: 'LV39',
};

DAS_THRESHOLDS[-1] = 'absent';

function _computeAndGetRunway(start_level) {
	const transition_lines = TRANSITIONS[start_level];

	if (!transition_lines) {
		return null;
	}

	const thresholds_lines = {
		[RUNWAY.TRANSITION]: transition_lines,
	};

	if (start_level < 19) {
		thresholds_lines[RUNWAY.LV19] =
			190 - ((start_level + 1) * 10 - transition_lines);
	}
	if (start_level < 29) {
		thresholds_lines[RUNWAY.LV29] =
			290 - ((start_level + 1) * 10 - transition_lines);
	}
	if (start_level < 39) {
		thresholds_lines[RUNWAY.LV39] =
			390 - ((start_level + 1) * 10 - transition_lines);
	}

	return _getRunwayForLevel(start_level, thresholds_lines);
}

function _getRunwayForLevel(start_level, thresholds_lines) {
	const transition_lines = thresholds_lines[RUNWAY.TRANSITION];

	// one time generation of score runways by line and best line clear strategy

	function clearScore(current_lines, clear) {
		const target_lines = current_lines + clear;

		let level;

		if (target_lines < transition_lines) {
			level = start_level;
		} else {
			level =
				start_level + 1 + Math.floor((target_lines - transition_lines) / 10);
		}

		return (level + 1) * SCORE_BASES[clear];
	}

	const runways = {};

	for (let [threshold_type, target_lines] of Object.entries(thresholds_lines)) {
		const runway = {
			[target_lines + 0]: 0,
			[target_lines + 1]: 0,
			[target_lines + 2]: 0,
			[target_lines + 3]: 0,
		};

		for (let lines = target_lines; lines--; ) {
			let best_score = 0;

			for (let clear = 4; clear > 0; clear--) {
				const new_score = clearScore(lines, clear) + runway[clear + lines];

				if (new_score > best_score) {
					best_score = new_score;
				}
			}

			runway[lines] = best_score;
		}

		runways[threshold_type] = runway;
	}

	return runways;
}

const RUNWAYS = {};

export function getRunway(start_level, type, lines) {
	let targetRunways = RUNWAYS[start_level];

	if (targetRunways === undefined) {
		targetRunways = RUNWAYS[start_level] = _computeAndGetRunway(start_level);
	}

	try {
		return targetRunways[type][lines] || 0;
	} catch (err) {
		console.warn(`Runway unavailable ${[start_level, type, lines]}`);
		return 0;
	}
}
