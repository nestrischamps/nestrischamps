import { timer } from './timer.js';
import { getStream } from './MediaUtils.js';

let driverSuffix = 0;

export class CaptureDriver extends EventTarget {
	constructor(config) {
		super();

		this.config = config;
		this.driverSuffix = ++driverSuffix;

		this.stream = getStream(config);
		this.captures = [];

		this.video = document.createElement('video');
		this.video.srcObject = stream;
		this.video.play();

		this.capture_canvas = document.createElement('canvas');
		this.capture_canvas.id = 'capture_canvas';

		this.#waitForVideoReady().then(() => {
			this.#startFrameCapture();
		});
	}

	addCapture(capture) {
		capture.setDriver(this);
		this.captures.push(capture);
	}

	async #waitForVideoReady() {
		return new Promise(resolve => {
			this.video.addEventListener(
				'loadedmetadata',
				() => {
					this.capture_canvas.width = this.video.videoWidth;
					this.capture_canvas.height =
						this.video.videoHeight >> (this.config.use_half_height ? 1 : 0);
					resolve();
				},
				{ once: true }
			);
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

	async #work(frame) {
		performance.mark(`capture-driver-start-${this.driverSuffix}`);

		let captureIdx = 0;

		for (const capture of this.captures) {
			captureIdx += 1;

			performance.mark(`capture-start-${this.driverSuffix}-${captureIdx}`);

			await capture.processVideoFrame(frame);

			performance.mark(`capture-end-${this.driverSuffix}-${captureIdx}`);
			performance.measure(
				`capture-${this.driverSuffix}-${captureIdx}`,
				`capture-start-${this.driverSuffix}-${captureIdx}`,
				`capture-end-${this.driverSuffix}-${captureIdx}`
			);
		}

		performance.mark(`capture-driver-end-${this.driverSuffix}`);
		performance.measure(
			`capture-driver-${this.driverSuffix}`,
			`capture-driver-start-${this.driverSuffix}`,
			`capture-driver-end-${this.driverSuffix}`
		);

		this.dispatchEvent(new CustomEvent('frame'));
	}
}
