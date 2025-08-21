import { sleep, timer } from './timer.js';
import { luma } from '/ocr/image_tools.js';
import { getStream } from './MediaUtils.js';

const DIGITS = '0123456789ABCDEF'.split('');
DIGITS.unshift('null');

async function getTemplateData(digit) {
	const response = await fetch(`/ocr/${digit.toLowerCase()}.png`);
	const blob = await response.blob();

	return createImageBitmap(blob);
}

let driverSuffix = 0;

export class CaptureDriver extends EventTarget {
	#working;
	#stream;
	#video;
	#gpu = null;

	constructor(config) {
		super();

		this.config = config;
		this.driverSuffix = ++driverSuffix;

		this.players = [];

		this.#video = document.createElement('video');

		this.digit_canvas_0 = document.createElement('canvas');
		this.digit_canvas_1 = document.createElement('canvas');

		Promise.all([
			this.#init(),
			this.#getGPU(),
			this.#waitForVideoReady(),
			this.#loadDigitTemplates(),
		]).then(() => {
			this.#startFrameCapture();
		});
	}

	async #init() {
		this.#stream = await getStream(this.config);
		this.#video.srcObject = this.#stream;
		this.#video.play();
	}

	async #getGPU() {
		if (navigator.gpu?.requestAdapter) {
			const adapter = await navigator.gpu.requestAdapter();
			const device = await adapter.requestDevice();
			const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

			this.#gpu = {
				adapter,
				device,
				canvasFormat,
			};
		}
	}

	addPlayer(player) {
		this.players.push(player);
	}

	getVideo() {
		return this.#video;
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

	async #waitForVideoReady() {
		return new Promise(resolve => {
			this.#video.addEventListener('loadedmetadata', resolve, { once: true });
		});
	}

	async *#frameGenerator() {
		const track = this.#video.srcObject.getVideoTracks()[0];
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
			console.log('MediaStreamTrackProcessor is supported');
			for await (const frame of this.#frameGenerator()) {
				try {
					await this.#work(frame);
				} catch (err) {
					console.warn(err);
				}
				frame.close();
			}
		} else {
			console.log('MediaStreamTrackProcessor is NOT supported');
			const frame_ms = 1000 / (this.config.frame_rate || 30);

			this.captureIntervalId = timer.setInterval(async () => {
				await this.#work();
			}, frame_ms);
		}
	}

	async #work(videoFrame) {
		if (this.#working) {
			console.warn('skip frame');
			return;
		}

		this.#working = true;

		performance.clearMarks();
		performance.clearMeasures();

		performance.mark(`player-driver-start-${this.driverSuffix}`);

		const frame = {
			gpu: this.#gpu,
			videoFrame,
			video: this.#video,
			digit_lumas: this.digit_lumas,
		};

		let playerIdx = 0;

		for (const player of this.players) {
			playerIdx += 1;

			performance.mark(`player-start-${this.driverSuffix}-${playerIdx}`);

			try {
				await player.processVideoFrame(frame);
			} catch (err) {
				console.warn(err);
			}

			performance.mark(`player-end-${this.driverSuffix}-${playerIdx}`);
			performance.measure(
				`player-${this.driverSuffix}-${playerIdx}`,
				`player-start-${this.driverSuffix}-${playerIdx}`,
				`player-end-${this.driverSuffix}-${playerIdx}`
			);

			await sleep(0);
		}

		performance.mark(`player-driver-end-${this.driverSuffix}`);
		performance.measure(
			`player-driver-${this.driverSuffix}`,
			`player-driver-start-${this.driverSuffix}`,
			`player-driver-end-${this.driverSuffix}`
		);

		this.dispatchEvent(new CustomEvent('frame'));

		this.#working = false;
	}
}
