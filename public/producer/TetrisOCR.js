import { CONFIGS, TASK_RESIZE } from './constants.js';
import { timingDecorator } from '/ocr/utils.js';
import { luma } from '/ocr/image_tools.js';

// canvas for the digit templates
const digit_canvas_0 = document.createElement('canvas');
const digit_canvas_1 = document.createElement('canvas');

const DIGITS = '0123456789ABCDEF'.split('');
DIGITS.unshift('null');

async function getTemplateData(digit) {
	const response = await fetch(`/ocr/${digit.toLowerCase()}.png`);
	const blob = await response.blob();

	return createImageBitmap(blob);
}

async function loadDigitTemplates() {
	const imgs = await Promise.all(DIGITS.map(getTemplateData));

	// we write all the templates in a row in a canva with 1px spacing in between
	// we scaled uniformly
	// we crop the scaled digits from their expected new location

	const width = DIGITS.length * 8 + 1;
	const height = 7;

	digit_canvas_0.width = width;
	digit_canvas_0.height = height;

	const ctx = digit_canvas_0.getContext('2d');

	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#000000FF';
	ctx.fillRect(0, 0, width, height);

	// draw all templates with one pixel border on each side
	imgs.forEach((img, idx) => ctx.drawImage(img, 1 + idx * 8, 0));

	digit_canvas_1.width = width * 2;
	digit_canvas_1.height = height * 2;

	const ctx1 = digit_canvas_1.getContext('2d', {
		willReadFrequently: true,
	});
	ctx1.drawImage(
		digit_canvas_0,
		0,
		0,
		width,
		height,
		0,
		0,
		width * 2,
		height * 2
	);

	return imgs.map((_, idx) => {
		const digit = ctx1.getImageData(2 + idx * 16, 0, 14, 14);

		// and now we compute the luma for the digit
		const lumas = new Float64Array(14 * 14);
		const pixel_data = digit.data;

		for (let idx = 0; idx < lumas.length; idx++) {
			const offset_idx = idx << 2;

			lumas[idx] = luma(
				pixel_data[offset_idx],
				pixel_data[offset_idx + 1],
				pixel_data[offset_idx + 2]
			);
		}

		return lumas;
	});
}

const loadDigitTemplatesPromise = loadDigitTemplates(); // no await!

let perfSuffix = 0;

export class TetrisOCR extends EventTarget {
	constructor(config) {
		super();

		this.perfSuffix = ++perfSuffix;

		this.configData = Object.values(CONFIGS).find(
			conf => conf.game_type === config.game_type
		);

		if (!this.configData) {
			throw new Error('Unable to find config data');
		}

		this.setConfig(config);

		this.capture_canvas = document.createElement('canvas');
		this.capture_canvas.id = 'capture_canvas';

		this.output_canvas = document.createElement('canvas');
		this.output_canvas.id = 'output_canvas';
		this.output_canvas.width = this.configData.packing.size.w;
		this.output_canvas.height = this.configData.packing.size.h;
	}

	setConfig(config) {
		this.config = config;
		this.palette = this.palettes?.[config.palette]; // will reset to undefined when needed

		this.pending_capture_reinit = true;

		for (const [name, task] of Object.entries(this.config.tasks)) {
			let resize_tuple;

			if (name === 'score' && config.score7) {
				resize_tuple = TASK_RESIZE.score7;
			} else {
				resize_tuple = TASK_RESIZE[name];
			}

			const canvas = document.createElement('canvas');
			canvas.width = resize_tuple.w;
			canvas.height = resize_tuple.h;

			task.canvas = canvas;
			task.packing_pos = this.configData.packing.positions[name];
		}
	}

	async processVideoFrame() {
		throw new Error('processVideoFrame(): child class to implement');
	}

	instrument(...methods) {
		methods.forEach(name => {
			const method = this[name].bind(this);
			this[name] = timingDecorator(`${name}-${this.perfSuffix}`, method);
		});
	}

	static loadDigitTemplates() {
		return loadDigitTemplatesPromise;
	}
}
