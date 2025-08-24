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

export function rgb2lab_normalizeRgbChannel(channel) {
	channel /= 255;

	return (
		100 *
		(channel > 0.04045
			? Math.pow((channel + 0.055) / 1.055, 2.4)
			: channel / 12.92)
	);
}

export function rgb2lab_normalizeXyzChannel(channel) {
	return channel > 0.008856
		? Math.pow(channel, 1 / 3)
		: 7.787 * channel + 16 / 116;
}

export function rgb2lab([r, g, b]) {
	r = rgb2lab_normalizeRgbChannel(r);
	g = rgb2lab_normalizeRgbChannel(g);
	b = rgb2lab_normalizeRgbChannel(b);

	let X = r * 0.4124 + g * 0.3576 + b * 0.1805;
	let Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
	let Z = r * 0.0193 + g * 0.1192 + b * 0.9505;

	// Observer= 2°, Illuminant= D65
	X = rgb2lab_normalizeXyzChannel(X / 95.047);
	Y = rgb2lab_normalizeXyzChannel(Y / 100.0);
	Z = rgb2lab_normalizeXyzChannel(Z / 108.883);

	return [
		116 * Y - 16, // L
		500 * (X - Y), // a
		200 * (Y - Z), // b
	];
}
