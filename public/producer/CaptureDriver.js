import QueryString from '/js/QueryString.js';
import { sleep, timer } from './timer.js';
import { getStream } from './MediaUtils.js';

const defaultDriverMode = (value =>
	/^(mstp|callback)$/.test(value) ? value : 'interval')(
	QueryString.get('capdriver')
);

let driverSuffix = 0;

export class CaptureDriver extends EventTarget {
	#working;
	#stream;
	#video;
	#captureIntervalId;
	#captureFrameCallbackId;
	#driverMode;
	#then;
	#curPlayerNum;

	constructor(config, stream = null, driverMode = null) {
		super();

		this.driverSuffix = ++driverSuffix;

		this.config = config;
		this.#stream = stream;
		this.#driverMode = driverMode || defaultDriverMode;

		this.players = [];

		this.#video = document.createElement('video');

		Promise.all([this.#init(), this.#waitForVideoReady()]).then(() => {
			this.#startFrameCapture();
		});
	}

	async #init() {
		if (!this.#stream) {
			this.#stream = await getStream(this.config);
		}
		this.#video.srcObject = this.#stream;
		this.#video.play();
	}

	addPlayer(player) {
		player._driver = this; // use a method?
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
		const MediaStreamTrackProcessorSupported =
			'MediaStreamTrackProcessor' in window;

		let trackFps = null;

		try {
			const track = this.#video.srcObject?.getVideoTracks()[0];
			trackFps = track.getSettings().frameRate;
		} catch (err) {
			// ignore 🤷
		}

		console.log(
			`#startFrameCapture: ${JSON.stringify(
				{
					driverMode: this.#driverMode,
					trackFps,
					MediaStreamTrackProcessorSupported,
				},
				null,
				2
			)}`
		);

		if (this.#driverMode === 'mstp' && MediaStreamTrackProcessorSupported) {
			console.log('Using MediaStreamTrackProcessor in driver');
			for await (const frame of this.#frameGenerator()) {
				try {
					await this.#work(frame);
				} catch (err) {
					console.warn(err);
				}
				frame.close();
			}
		} else if (this.#driverMode === 'callback') {
			console.log('Using requestVideoFrameCallback in driver');
			const tick = async () => {
				// schedule next frame capture before work
				// if it fires early, a frame skip warning will be shown
				this.#captureFrameCallbackId =
					this.#video.requestVideoFrameCallback(tick);

				try {
					await this.#work();
				} catch (err) {
					console.warn(err);
				}
			};
			this.#captureFrameCallbackId =
				this.#video.requestVideoFrameCallback(tick);
		} else {
			const frame_rate = trackFps || this.config.frame_rate || 30;
			const frame_ms = 1000 / frame_rate; // at ms accuracy, it drifts

			console.log(
				`Using Interval in driver at ${frame_rate}fps (${frame_ms} ms/frame)`
			);

			this.#captureIntervalId = timer.setInterval(async () => {
				await this.#work();
			}, frame_ms);
		}
	}

	async #work(videoFrame) {
		const now = performance.now();

		if (this.#working) {
			console.warn(
				`skip frame. Elapsed: ${(now - (this.#then || 0)).toFixed(1)}. Current player work: ${this.#curPlayerNum}`
			);
			return;
		}

		this.#working = true;
		this.#then = now;

		performance.clearMarks();
		performance.clearMeasures();

		performance.mark(`start-driver-${this.driverSuffix}`);

		const frame = {
			videoFrame,
			video: this.#video,
		};

		// Run all players in parallel
		await Promise.allSettled(this.players.map(p => p.processVideoFrame(frame)));

		performance.mark(`end-driver-${this.driverSuffix}`);
		performance.measure(
			`driver-${this.driverSuffix}`,
			`start-driver-${this.driverSuffix}`,
			`end-driver-${this.driverSuffix}`
		);

		this.#curPlayerNum = null;

		this.dispatchEvent(new CustomEvent('frame'));

		this.#working = false;
	}

	destroy() {
		if (this.#captureIntervalId) clearInterval(this.#captureIntervalId);

		if (this.#captureFrameCallbackId)
			this.#video.cancelVideoFrameCallback(this.#captureFrameCallbackId);

		if (this.#stream) {
			this.#stream.getTracks().forEach(track => track.stop());
		}
	}
}
