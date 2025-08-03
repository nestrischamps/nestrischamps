const LIST = ['easiercap'];

async function getPalette(name) {
	const response = await fetch(`/ocr/palettes/${name}.json`);
	const json = await response.json();

	return json.map(([color1, color2]) => [
		new Uint8Array(color1),
		new Uint8Array(color2),
	]);
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
