export function flood(
	img_data,
	[startX, startY],
	color = [0, 0, 0],
	tolerance = 25
) {
	console.log({
		msg: 'Initiating flood-fill',
		startX,
		startY,
	});

	const squared_tolerance = tolerance * tolerance;

	const seen = new Array(img_data.width)
		.fill()
		.map(_ => new Array(img_data.height).fill());

	function check(x, y) {
		const start_index = 4 * (y * img_data.width + x);
		const data = img_data.data;
		return (
			Math.pow(data[start_index + 0] - color[0], 2) < squared_tolerance &&
			Math.pow(data[start_index + 1] - color[1], 2) < squared_tolerance &&
			Math.pow(data[start_index + 2] - color[2], 2) < squared_tolerance
		);
	}

	function handled(x, y) {
		return seen[x][y] !== undefined;
	}

	if (!check(startX, startY)) {
		// Unfortunate failure to even start the flood-fill T_T
		// Let's gather more information to make the errors more descriptive, and thus troubleshooting easier

		const start_index = 4 * (startY * img_data.width + startX);
		const data = img_data.data;
		const distances = [
			data[start_index + 0] - color[0],
			data[start_index + 1] - color[1],
			data[start_index + 2] - color[2],
		];
		const squared_distances = distances.map(d => d * d);

		const error_data = {
			msg: 'Starting point does not match color',
			target: color,
			selected: [
				data[start_index + 0],
				data[start_index + 1],
				data[start_index + 2],
			],
			tolerance,
			distances,
			euclidian_distance: Math.sqrt(
				squared_distances.reduce((acc, v) => acc + v, 0)
			),
			squared_tolerance,
			squared_distances,
		};

		console.error(JSON.stringify(error_data, null, 2));

		throw new Error(error_data.msg, {
			cause: error_data,
		});
	}

	function maybeAddToQueue(tx, ty) {
		if (tx < 0 || tx >= img_data.width) return;
		if (ty < 0 || ty >= img_data.height) return;

		if (!handled(tx, ty)) {
			queue.push([tx, ty]);
		}
	}

	const queue = [[startX, startY]];

	while (queue.length) {
		const [x, y] = queue.shift();
		if (handled(x, y)) continue;

		seen[x][y] = check(x, y);

		if (!seen[x][y]) continue;

		maybeAddToQueue(x - 1, y);
		maybeAddToQueue(x + 1, y);
		maybeAddToQueue(x, y - 1);
		maybeAddToQueue(x, y + 1);
	}

	return seen;
}

export function getFieldCoordinates(
	img_data,
	startPoint,
	color = [0, 0, 0],
	tolerance = 25
) {
	const result = flood(img_data, startPoint, color, tolerance);

	const [top, left, bottom, right] = result.reduce(
		([t, l, b, r], column, x) => {
			column.forEach((isBlack, y) => {
				if (isBlack) {
					if (x < l) l = x;
					if (x > r) r = x;
					if (y < t) t = y;
					if (y > b) b = y;
				}
			});
			return [t, l, b, r];
		},
		[Infinity, Infinity, -1, -1]
	);

	return [left, top, right - left + 1, bottom - top + 1];
}

export function getCaptureCoordinates(
	reference_size,
	ideal_field_w_border_xywh,
	field_w_border_xywh
) {
	const scaleX = field_w_border_xywh[2] / ideal_field_w_border_xywh[2];
	const scaleY = field_w_border_xywh[3] / ideal_field_w_border_xywh[3];

	return [
		field_w_border_xywh[0] - ideal_field_w_border_xywh[0] * scaleX,
		field_w_border_xywh[1] - ideal_field_w_border_xywh[1] * scaleY,
		scaleX * reference_size[0],
		scaleY * reference_size[1],
	];
}
