const LIST = ['easiercap'];

const DEFAULT_COLOR_1 = [0xf0, 0xf0, 0xf0];

async function getSavedPalette() {
	try {
		const saved_palette = localStorage.getItem('palette');
		if (saved_palette) {
			// TODO: verify that palette has right format too
			return JSON.parse(saved_palette);
		}
	} catch (err) {}

	return null;
}

export async function getPalette(name) {
	if (name === '_saved') {
		return getSavedPalette();
	}

	const response = await fetch(`/ocr/palettes/${name}.json`);
	const json = await response.json();

	return json.map(colors => {
		if (colors.length === 2) {
			colors.unshift(DEFAULT_COLOR_1);
		}
		return colors;
	});
}

async function _loadPalettes() {
	const _palettes = {};

	try {
		const saved_palette = localStorage.getItem('palette');
		if (saved_palette) {
			// TODO: verify that palette has right format too
			_palettes._saved = JSON.parse(saved_palette);
		}
	} catch (err) {}

	(await Promise.all(LIST.map(getPalette))).forEach((palette, idx) => {
		_palettes[LIST[idx]] = palette;
	});

	return _palettes;
}

let palettes = _loadPalettes();

export default function loadPalettes() {
	return palettes; // everybody shares the same promise!
}
