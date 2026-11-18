// offsets extracted from
// https://github.com/kirjavascript/TetrisGYM/blob/master/src/ram.asm
// and
// https://github.com/zohassadar/TetrisGYM/blob/ed2ntc/src/nmi/ed2ntc.asm
// id to [address, num_bytes]
const gym6_data_maps = {
	gameMode: [0xc0, 1], // gameMode
	playState: [0x48, 1], // playState
	// For future use
	// gameModeState: [0xA7, 1], // gameModeState
	completedRowXClear: [0x52, 1], // rowY (rowY is a terrible name in Rom)
	completedRows: [0x4a, 4], // completedRow
	lines: [0x50, 2], // lines
	level: [0x44, 1], // levelNumber
	score: [0x8, 4], // binScore
	nextPieceOrientation: [0xbf, 1], // nextPiece
	tetriminoOrientation: [0x42, 1], // currentPiece
	tetriminoX: [0x40, 1], // tetriminoX
	tetriminoY: [0x41, 1], // tetriminoY
	frameCounter: [0xb1, 2], // frameCounter
	autoRepeatX: [0x46, 1], // autorepeatX
	stats: [0x3f0, 7 * 2], // statsByType
	field: [0x400, 200], // playfield
};

export const address_maps = {
	gym6: gym6_data_maps,
};

// The 2 functions below work because Javascript guarantees iteration order for objects
export function getDataAddresses(definition) {
	const values = Object.values(definition);
	const res = new Uint16Array(values.length * 2);

	values.forEach(([addr, size], idx) => {
		res[idx * 2] = addr;
		res[idx * 2 + 1] = size;
	});

	return res;
}

export function assignData(rawData, definition) {
	const entries = Object.entries(definition);
	const result = { ...definition };

	// raw assignments first
	let offset = 0;
	entries.forEach(([key, [_addr, size]]) => {
		if (size === 1) {
			result[key] = rawData[offset];
		} else {
			result[key] = rawData.slice(offset, offset + size);
		}
		offset += size;
	});

	// data transformation
	result.score =
		(result.score[3] << 24) |
		(result.score[2] << 16) |
		(result.score[1] << 8) |
		result.score[0];
	result.frameCounter = (result.frameCounter[1] << 8) | result.frameCounter[0];
	result.lines = _bcdToDecimal(result.lines[0], result.lines[1]);

	let statsByteIndex = 0;
	result.T = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.J = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.Z = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.O = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.S = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.L = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	result.I = _bcdToDecimal(
		result.stats[statsByteIndex++],
		result.stats[statsByteIndex++]
	);
	delete result.stats;

	result.field = result.field.map(
		tileId => TILE_ID_TO_NTC_BLOCK_ID.get(tileId) ?? tileId
	);

	return result;
}
