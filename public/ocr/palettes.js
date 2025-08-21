const LIST = ['easiercap', 'retron1hd'];

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

const palettePromises = {};

export function getPalette(name) {
	if (!name) return null;

	if (name === '_saved') {
		return getSavedPalette();
	}

	if (!palettePromises[name]) {
		palettePromises[name] = (async () => {
			const response = await fetch(`/ocr/palettes/${name}.json`);
			const json = await response.json();

			return json.map(colors => {
				if (colors.length === 2) {
					colors.unshift(DEFAULT_COLOR_1);
				}
				return colors;
			});
		})();
	}

	return palettePromises[name];
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

let palettes = null;

export default function loadPalettes() {
	if (!palettes) {
		palettes = _loadPalettes(); // lazy loading the palettes
	}

	return palettes; // all callers shares the same promise!
}
