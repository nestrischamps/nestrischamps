import { timer } from './timer.js';
import {
	CONFIGS,
	TASK_RESIZE,
	GYM_PAUSE_CROP_RELATIVE_TO_FIELD,
} from './constants.js';
import { luma } from '/ocr/image_tools.js';

const DIGITS = '0123456789ABCDEF'.split('');

DIGITS.unshift('null');

async function getTemplateData(digit) {
	const response = await fetch(`/ocr/${digit.toLowerCase()}.png`);
	const blob = await response.blob();

	return createImageBitmap(blob);
}

export class TetrisOCR extends EventTarget {
	constructor(stream, config) {
		super();

		this.config = config;

		this.configData = Object.values(CONFIGS).find(
			conf => conf.game_type === config.game_type
		);

		if (!this.configData) {
			throw new Error('Unable to find config data');
		}

		this.video = document.createElement('video');
		this.video.srcObject = stream;
		this.video.play();

		this.setConfig(config);

		this.output_canvas = document.createElement('canvas');
		this.output_canvas.id = 'output_canvas';
		this.output_canvas.width = this.configData.packing.size.w;
		this.output_canvas.height = this.configData.packing.size.h;

		this.capture_canvas = document.createElement('canvas');
		this.capture_canvas.id = 'capture_canvas';

		this.digit_canvas_0 = document.createElement('canvas');
		this.digit_canvas_1 = document.createElement('canvas');
		// this.digit_canvas_2 = document.createElement('canvas');

		Promise.all([this.#waitForVideoReady(), this.#loadDigitTemplates()]).then(
			() => {
				this.#startFrameCapture();
			}
		);
	}

	async #waitForVideoReady() {
		return new Promise(resolve => {
			this.video.addEventListener(
				'loadedmetadata',
				() => {
					this.capture_canvas.width = this.video.videoWidth;
					this.capture_canvas.height = this.video.videoHeight;
					resolve();
				},
				{ once: true }
			);
		});
	}

	async #loadDigitTemplates() {
		const imgs = await Promise.all(DIGITS.map(getTemplateData));

		// we write all the templates in a row in a canva with 1px spacing in between
		// we scaled uniformly
		// we crop the scaled digits from their expected new location

		const width = DIGITS.length * 8 + 1;
		const height = 7;

		this.digit_canvas_0.width = width;
		this.digit_canvas_0.height = height;

		const ctx = this.digit_canvas_0.getContext('2d');

		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#000000FF';
		ctx.fillRect(0, 0, width, height);

		// draw all templates with one pixel border on each side
		imgs.forEach((img, idx) => ctx.drawImage(img, 1 + idx * 8, 0));

		this.digit_canvas_1.width = width * 2;
		this.digit_canvas_1.height = height * 2;

		const ctx1 = this.digit_canvas_1.getContext('2d', {
			willReadFrequently: true,
		});
		ctx1.drawImage(
			this.digit_canvas_0,
			0,
			0,
			width,
			height,
			0,
			0,
			width * 2,
			height * 2
		);

		// const source = ctx.getImageData(0, 0, width, height);
		// const scaled = new ImageData(width * 2, height * 2);

		// this.digit_canvas_2.width = width * 2;
		// this.digit_canvas_2.height = height * 2;

		// bicubic(source, scaled);

		// const ctx2 = this.digit_canvas_2.getContext('2d');
		// ctx2.putImageData(scaled, 0, 0);

		this.digit_lumas = imgs.map((_, idx) => {
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

	setConfig(config) {
		this.config = config;
		this.palette = this.palettes?.[config.palette]; // will reset to undefined when needed

		this.pending_capture_reinit = true;
		this.#fixPalette();

		this.all_tasks = { ...this.config.tasks };

		if (!this.config.tasks.instant_das) {
			const field_crop = this.config.tasks.field.crop;

			const scaleX = field_crop.w / TASK_RESIZE.field.w;
			const scaleY = field_crop.h / TASK_RESIZE.field.h;

			// we compute the gym_pause crop in relation to the field
			const gym_pause_crop_coordinates = {
				x: Math.round(
					field_crop.x + GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x * scaleX
				),
				y: Math.round(
					field_crop.y + GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y * scaleY
				),
				w: Math.round(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.w * scaleX),
				h: Math.round(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.h * scaleY),
			};

			// Safety check on capture area size (zero size is not acceptable)
			if (
				gym_pause_crop_coordinates.w > 0 &&
				gym_pause_crop_coordinates.h > 0
			) {
				this.all_tasks.gym_pause = { crop: gym_pause_crop_coordinates };
			}
		}

		for (const [name, task] of Object.entries(this.all_tasks)) {
			console.log({ name, task });

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

	#fixPalette() {
		if (!this.palette) return;

		this.palette = this.palette.map(colors => {
			if (colors.length == 2) {
				return [DEFAULT_COLOR_1, colors[0], colors[1]];
			}

			return colors;
		});
	}

	async *#frameGenerator() {
		const track = this.video.srcObject.getVideoTracks()[0];
		const processor = new MediaStreamTrackProcessor({ track });
		const reader = processor.readable.getReader();

		while (true) {
			const { value: videoFrame, done } = await reader.read();
			if (done) break;
			yield videoFrame;
		}
	}

	async #startFrameCapture() {
		console.log('#startFrameCapture');

		if ('MediaStreamTrackProcessor' in window) {
			for await (const frame of this.#frameGenerator()) {
				await this.#work(frame);
				frame.close();
			}
		} else {
			const frame_ms = 1000 / this.config.frame_rate;

			this.captureIntervalId = timer.setInterval(async () => {
				await this.#work();
			});
		}
	}

	async #work(frame) {
		const res = await this.processVideoFrame(frame);
		const perf = {};

		performance.getEntriesByType('measure').forEach(m => {
			// discard browser performance measurements -_-
			if (m.name.startsWith('browser::')) return;
			if (m.name.startsWith('invoke-')) return;
			if (m.name.startsWith('inline-')) return;
			if (m.name.startsWith('DOM-')) return;
			if (m.name.startsWith('ANALYZE_')) return;

			perf[m.name] = m.duration.toFixed(3);
		});

		const { total } = perf;

		delete perf.total;
		perf.TOTAL = total;

		const event = new CustomEvent('frame', {
			detail: { frame: res, perf },
		});

		this.dispatchEvent(event);
	}

	async processVideoFrame() {
		throw new Error('processVideoFrame(): child class to implement');
	}
}
