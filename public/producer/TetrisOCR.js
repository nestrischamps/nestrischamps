import { timer } from './timer.js';
import {
	CONFIGS,
	TASK_RESIZE,
	GYM_PAUSE_CROP_RELATIVE_TO_FIELD,
} from './constants.js';

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
		this.output_canvas.width = this.configData.webgpu.packing_size.w;
		this.output_canvas.height = this.configData.webgpu.packing_size.h;

		this.capture_canvas = document.createElement('canvas');
		this.capture_canvas.id = 'capture_canvas';

		this.video.addEventListener(
			'loadedmetadata',
			() => {
				this.capture_canvas.width = this.video.videoWidth;
				this.capture_canvas.height = this.video.videoHeight;
				this.#startFrameCapture();
			},
			{ once: true }
		);
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
		await this.processVideoFrame(frame);

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

		const event = new CustomEvent('frame', {
			detail: { frame: {}, perf },
		});

		this.dispatchEvent(event);
	}

	async processVideoFrame() {
		throw new Error('processVideoFrame(): child class to implement');
	}
}
