export function timingDecorator(name, func) {
	// func must be prebound
	return function (...args) {
		performance.mark(`start_${name}`);

		const res = func(...args);

		performance.mark(`end_${name}`);
		performance.measure(name, `start_${name}`, `end_${name}`);

		return res;
	};
}

export function clamp(value, low, high) {
	if (value < low) return low;
	if (value > high) return high;
	return value;
}

export function findMinIndex(arr) {
	if (arr.length === 0) {
		return -1;
	}

	let minIndex = 0;

	for (let i = 1; i < arr.length; i++) {
		if (arr[i] < arr[minIndex]) {
			minIndex = i;
		}
	}

	return minIndex;
}

export function u32ToRgba(u) {
	return [
		(u >>> 0) & 0xff, // R
		(u >>> 8) & 0xff, // G
		(u >>> 16) & 0xff, // B
		(u >>> 24) & 0xff, // A (or shine ho ho ho!)
	];
}

export function rgbaToU32(r, g, b, a) {
	return (
		((r & 0xff) << 0) |
		((g & 0xff) << 8) |
		((b & 0xff) << 16) |
		((a & 0xff) << 24)
	);
}

/* === new oklab functions === */

/**
 * Convert one 8-bit sRGB channel to linear sRGB.
 * @param {number} c8 - 0..255
 * @returns {number} linear 0..1
 */
function srgb8ToLinear(c8) {
	const c = c8 / 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const cbrt = Math.cbrt || (x => Math.sign(x) * Math.pow(Math.abs(x), 1 / 3));

/**
 * Convert sRGB (8-bit per channel) to OKLab.
 * @param {[number, number, number]} rgb - [R, G, B] in 0..255
 * @returns {{L:number, a:number, b:number}}
 */
export function rgbToOklab(rgb) {
	let [R8, G8, B8] = rgb;

	// Linearize
	const R = srgb8ToLinear(R8);
	const G = srgb8ToLinear(G8);
	const B = srgb8ToLinear(B8);

	// Linear sRGB to LMS
	const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
	const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
	const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;

	// Nonlinear transform
	const l_ = cbrt(l);
	const m_ = cbrt(m);
	const s_ = cbrt(s);

	// LMS to OKLab
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	return { L, a, b };
}

/**
 * Weighted squared distance in OKLab.
 * wL < 1 reduces sensitivity to lightness differences.
 * Typical: wL = 0.4..0.7, wa = 1, wb = 1.
 */
export function oklabDist2Weighted(x, y, wL = 0.5, wa = 1, wb = 1) {
	const dL = x.L - y.L;
	const da = x.a - y.a;
	const db = x.b - y.b;
	return wL * dL * dL + wa * da * da + wb * db * db;
}

/**
 * Find the index of the closest color in a reference palette by OKLab distance.
 * Reference colors are given as sRGB [R,G,B] in 0..255.
 * @param {[number,number,number]} targetRgb
 * @param {Array<[number,number,number]>} referenceRgbs
 * @returns {number} index of the closest color
 */
export function findClosestOklabIndex(targetRgb, referenceLabs) {
	const targetLab = rgbToOklab(targetRgb);
	let bestIdx = -1;
	let bestD2 = Infinity;

	for (let i = 0; i < referenceLabs.length; i++) {
		const lab = referenceLabs[i];
		const d2 = oklabDist2Weighted(targetLab, lab);
		if (d2 < bestD2) {
			bestD2 = d2;
			bestIdx = i;
		}
	}
	return bestIdx;
}
