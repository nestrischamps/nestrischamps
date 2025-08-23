import { sleep, timer } from './timer.js';
import { getStream } from './MediaUtils.js';

let driverSuffix = 0;

export class CaptureDriver extends EventTarget {
	#working;
	#stream;
	#video;

	constructor(config) {
		super();

		this.config = config;
		this.driverSuffix = ++driverSuffix;
		this.players = [];

		this.#video = document.createElement('video');

		Promise.all([this.#init(), this.#waitForVideoReady()]).then(() => {
			this.#startFrameCapture();
		});
	}

	async #init() {
		this.#stream = await getStream(this.config);
		this.#video.srcObject = this.#stream;
		this.#video.play();
	}

	addPlayer(player) {
		this.players.push(player);
	}

	getVideo() {
		return this.#video;
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

		const now = Date.now();
		// if (this.then) {
		// 	console.log('elapsed: ', now - this.then);
		// }
		this.then = now;

		this.#working = true;

		performance.clearMarks();
		performance.clearMeasures();

		performance.mark(`player-driver-start-${this.driverSuffix}`);

		const frame = {
			videoFrame,
			video: this.#video,
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

		// console.log('work', Date.now() - now);

		this.dispatchEvent(new CustomEvent('frame'));

		this.#working = false;
	}
}
