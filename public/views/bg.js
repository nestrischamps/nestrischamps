import QueryString from '/js/QueryString.js';
import { PIECES } from '/views/constants.js';
import { shuffle } from '/views/utils.js';

const parent = document.querySelector('#stream_bg');

if (QueryString.get('bg') === '0') {
} else if (QueryString.get('bg') === '5') {
	const bg = document.createElement('div');
	parent.style.backgroundColor = 'black';
	bg.classList.add('bg');

	const bounds = parent.getBoundingClientRect();

	const spacer_w = 160;
	const spacer_h = 40;
	const canvas_w = bounds.width + spacer_w * 2;
	const canvas_h = bounds.height + spacer_h * 2;

	const trophy_base_uri = '/brand/trophies/';
	const trophy_nums = Array(20)
		.fill()
		.map((_, idx) => idx + 1);

	const columns = Math.ceil(canvas_w / spacer_w);
	const rows = Math.ceil(canvas_h / spacer_h);

	let num_trophy_set = Math.ceil((columns * rows) / trophy_nums.length);

	const trophies = [];

	while (num_trophy_set--) {
		trophies.push(...shuffle(trophy_nums.concat()));
	}

	shuffle(trophies);

	trophies.length = columns * rows;

	for (let y = rows; y--; ) {
		const offset_x = -(y % 2 === 0 ? 0 : spacer_w / 2);
		const offset_y = -(y % 2 === 0 ? 0 : spacer_h / 2) - spacer_h;

		for (let x = columns; x--; ) {
			const trophy_num = trophies.shift();
			const img = new Image();
			img.src = `${trophy_base_uri}${trophy_num}.2x.png`;

			img.loc = {
				x: offset_x + x * spacer_w,
				y: offset_y + y * spacer_h,
			};

			Object.assign(img.style, {
				left: `${img.loc.x}px`,
				top: `${img.loc.y}px`,
				position: 'absolute',
			});

			bg.appendChild(img);
			trophies.push(img);
		}
	}

	setInterval(() => {
		trophies.forEach(img => {
			if (++img.loc.x > canvas_w - spacer_w * 2) {
				img.loc.x -= canvas_w;
			}
			if (++img.loc.y > canvas_h - spacer_h * 2) {
				img.loc.y -= canvas_h;
			}

			img.style.left = `${img.loc.x}px`;
			img.style.top = `${img.loc.y}px`;
		});
	}, 1000 / 30);

	parent.prepend(bg);
} else if (
	QueryString.get('bg') === '2' ||
	QueryString.get('bg') === '3' ||
	QueryString.get('bg') === '4'
) {
	const bgs = {
		2: 'nestrischamps_bg_green.png',
		3: 'nestrischamps_bg.png',
		4: 'nestrischamps_bg_green.gif',
	};

	const img_width = 218;
	const bg_file = bgs[QueryString.get('bg')];
	const bg = document.createElement('div');

	bg.classList.add('bg');

	Object.assign(bg.style, {
		position: 'absolute',
		width: '121%',
		height: '133%',
		top: '-16%',
		left: '-15%',
		background: `url(/views/${bg_file}) 0 0 repeat`,
		transform: 'rotate(-11deg)',
	});

	let pos = 0;

	setInterval(() => {
		pos = ++pos % img_width;
		bg.style.backgroundPositionX = `${pos}px`;
	}, 1000 / 30);

	parent.prepend(bg);
} else {
	// bg=1 (default pieces)
	const bounds = parent.getBoundingClientRect();

	const width = bounds.width;
	const height = bounds.height;

	const border = 100;

	const grid_x = 8;
	const grid_y = 5;

	const span_x = (width - border * 2) / (grid_x - 1);
	const span_y = (height - border * 2) / (grid_y - 1);

	const spread = 1 / 3;

	const pieces = [];

	let num_bags = Math.ceil((grid_x * grid_y) / PIECES.length);

	while (num_bags--) {
		pieces.push(...shuffle(PIECES.concat()));
	}

	const bg = document.createElement('div');

	bg.classList.add('bg');

	for (let x = grid_x; x--; ) {
		for (let y = grid_y; y--; ) {
			const piece = pieces.pop();
			const img = new Image();

			img.src = `/views/bg_pieces/${piece}.png`;

			const pos_x = Math.round(
				border / 2 + span_x * (x - spread + 2 * spread * Math.random())
			);
			const pos_y = Math.round(
				border + span_y * (y - spread + 2 * spread * Math.random())
			);

			Object.assign(img.style, {
				left: `${pos_x}px`,
				top: `${pos_y}px`,
				position: 'absolute',
				transform: `rotate(${90 * Math.floor(Math.random() * 4)}deg)`,
			});

			bg.appendChild(img);
		}
	}

	parent.style.backgroundColor = 'black';

	parent.prepend(bg);
}

export default {};
