if (
	typeof CanvasRenderingContext2D !== 'undefined' &&
	!CanvasRenderingContext2D.prototype.clear
) {
	CanvasRenderingContext2D.prototype.clear = function (preserveTransform) {
		if (preserveTransform) {
			this.save();
			this.setTransform(1, 0, 0, 1, 0, 0);
		}

		this.clearRect(0, 0, this.canvas.width, this.canvas.height);

		if (preserveTransform) {
			this.restore();
		}
	};
}

// bicubic interpolation taken from
// https://www.strauss-engineering.ch/js-bilinear-interpolation.html

export function TERP(t, a, b, c, d) {
	return (
		0.5 *
			(c -
				a +
				(2.0 * a - 5.0 * b + 4.0 * c - d + (3.0 * (b - c) + d - a) * t) * t) *
			t +
		b
	);
}

export function BicubicInterpolation(x, y, values) {
	const i0 = TERP(x, values[0], values[1], values[2], values[3]);
	const i1 = TERP(x, values[4], values[5], values[6], values[7]);
	const i2 = TERP(x, values[8], values[9], values[10], values[11]);
	const i3 = TERP(x, values[12], values[13], values[14], values[15]);

	return TERP(y, i0, i1, i2, i3);
}

//
export function getBicubicPixels(srcImg, [dw, dh], destCoords) {
	const sdata = srcImg.data;
	const sw = srcImg.width;
	const sh = srcImg.height;
	const yscale = dh / sh;
	const xscale = dw / sw;

	const buffer = new Uint8Array(16);

	// [x, y] are in the destination reference
	return destCoords.map(([x, y]) => {
		const ixv = x / xscale;
		const iyv = y / yscale;
		const ix0 = Math.floor(ixv);
		const iy0 = Math.floor(iyv);

		// We have to special-case the pixels along the border and repeat their values if neccessary
		let repeatY = 0;
		if (iy0 < 1) repeatY = -1;
		else if (iy0 > sh - 3) repeatY = iy0 - (sh - 3);

		// We have to special-case the pixels along the border and repeat their values if neccessary
		let repeatX = 0;
		if (ix0 < 1) repeatX = -1;
		else if (ix0 > sw - 3) repeatX = ix0 - (sw - 3);

		const offset_row1 = (iy0 * sw + ix0) * 4;
		const offset_row0 = repeatY < 0 ? offset_row1 : ((iy0 - 1) * sw + ix0) * 4;
		const offset_row2 = repeatY > 1 ? offset_row1 : ((iy0 + 1) * sw + ix0) * 4;
		const offset_row3 = repeatY > 0 ? offset_row2 : ((iy0 + 2) * sw + ix0) * 4;

		const offset_col1 = 0;
		const offset_col0 = repeatX < 0 ? offset_col1 : -4;
		const offset_col2 = repeatX > 1 ? offset_col1 : 4;
		const offset_col3 = repeatX > 0 ? offset_col2 : 8;

		const offsets = [
			offset_row0 + offset_col0,
			offset_row0 + offset_col1,
			offset_row0 + offset_col2,
			offset_row0 + offset_col3,
			offset_row1 + offset_col0,
			offset_row1 + offset_col1,
			offset_row1 + offset_col2,
			offset_row1 + offset_col3,
			offset_row2 + offset_col0,
			offset_row2 + offset_col1,
			offset_row2 + offset_col2,
			offset_row2 + offset_col3,
			offset_row3 + offset_col0,
			offset_row3 + offset_col1,
			offset_row3 + offset_col2,
			offset_row3 + offset_col3,
		];

		const dx = ixv - ix0;
		const dy = iyv - iy0;
		const res = new Uint8ClampedArray(3);

		offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset]));
		res[0] = BicubicInterpolation(dx, dy, buffer);

		offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset + 1]));
		res[1] = BicubicInterpolation(dx, dy, buffer);

		offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset + 2]));
		res[2] = BicubicInterpolation(dx, dy, buffer);

		return res;
	});
}

export function bicubic(srcImg, destImg) {
	const sdata = srcImg.data;
	const sw = srcImg.width;
	const sh = srcImg.height;
	const dw = destImg.width;
	const dh = destImg.height;
	const yscale = dh / sh;
	const xscale = dw / sw;

	const buffer = new Uint8Array(16);

	for (let i = 0; i < dh; ++i) {
		const iyv = i / yscale;
		const iy0 = Math.floor(iyv);

		// We have to special-case the pixels along the border and repeat their values if neccessary
		let repeatY = 0;
		if (iy0 < 1) repeatY = -1;
		else if (iy0 > sh - 3) repeatY = iy0 - (sh - 3);

		for (let j = 0; j < dw; ++j) {
			const ixv = j / xscale;
			const ix0 = Math.floor(ixv);

			// We have to special-case the pixels along the border and repeat their values if neccessary
			let repeatX = 0;
			if (ix0 < 1) repeatX = -1;
			else if (ix0 > sw - 3) repeatX = ix0 - (sw - 3);

			const offset_row1 = (iy0 * sw + ix0) * 4;
			const offset_row0 =
				repeatY < 0 ? offset_row1 : ((iy0 - 1) * sw + ix0) * 4;
			const offset_row2 =
				repeatY > 1 ? offset_row1 : ((iy0 + 1) * sw + ix0) * 4;
			const offset_row3 =
				repeatY > 0 ? offset_row2 : ((iy0 + 2) * sw + ix0) * 4;

			const offset_col1 = 0;
			const offset_col0 = repeatX < 0 ? offset_col1 : -4;
			const offset_col2 = repeatX > 1 ? offset_col1 : 4;
			const offset_col3 = repeatX > 0 ? offset_col2 : 8;

			const offsets = [
				offset_row0 + offset_col0,
				offset_row0 + offset_col1,
				offset_row0 + offset_col2,
				offset_row0 + offset_col3,
				offset_row1 + offset_col0,
				offset_row1 + offset_col1,
				offset_row1 + offset_col2,
				offset_row1 + offset_col3,
				offset_row2 + offset_col0,
				offset_row2 + offset_col1,
				offset_row2 + offset_col2,
				offset_row2 + offset_col3,
				offset_row3 + offset_col0,
				offset_row3 + offset_col1,
				offset_row3 + offset_col2,
				offset_row3 + offset_col3,
			];

			const dx = ixv - ix0;
			const dy = iyv - iy0;
			const idxD = (i * dw + j) << 2;

			offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset]));
			destImg.data[idxD] = BicubicInterpolation(dx, dy, buffer);

			offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset + 1]));
			destImg.data[idxD + 1] = BicubicInterpolation(dx, dy, buffer);

			offsets.forEach((offset, idx) => (buffer[idx] = sdata[offset + 2]));
			destImg.data[idxD + 2] = BicubicInterpolation(dx, dy, buffer);

			// offsets.forEach((offset, idx) => buffer[idx] = sdata[offset+3]);
			// destImg.data[idxD+3] = BicubicInterpolation(dx, dy, buffer);
			destImg.data[idxD + 3] = 255;
		}
	}
}

export function crop(source, x, y, w, h, target = null) {
	if (!target) {
		target = new ImageData(w, h);
	}

	for (let row_idx = 0; row_idx < h; row_idx++) {
		const start_idx = ((row_idx + y) * source.width + x) << 2;
		const slice = source.data.subarray(
			// subarray allow passing by references
			start_idx,
			start_idx + w * 4
		);
		target.data.set(slice, row_idx * w * 4);
	}

	return target;
}

// if target is not supplied, modifies source image in place
// with resulting top half being the deinterlaced copy
export function deinterlace(source, target) {
	const row_len = source.width << 2;
	const max_rows = source.height >>> 1;

	if (!target) {
		for (let row_idx = 1; row_idx < max_rows; row_idx++) {
			source.data.copyWithin(
				row_len * row_idx,
				row_len * row_idx * 2,
				row_len * (row_idx * 2 + 1)
			);
		}

		return source;
	} else {
		// assume targets is the correct size
		for (let row_idx = 0; row_idx < max_rows; row_idx++) {
			const tgt_offset = row_len * row_idx;
			const src_offset = tgt_offset * 2;
			const slice = source.data.subarray(src_offset, src_offset + row_len);
			target.set(slice, tgt_offset);
		}

		return target;
	}
}

export function luma(r, g, b) {
	return r * 0.299 + g * 0.587 + b * 0.114;
}

export function roundedLuma(r, g, b) {
	return Math.round(luma(r, g, b));
}
