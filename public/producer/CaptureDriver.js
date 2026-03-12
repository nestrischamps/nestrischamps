import QueryString from '/js/QueryString.js';
import { timer } from './timer.js';
import { getStream, getDeviceLabel } from './MediaUtils.js';
import { getOcrClass } from './ocrStrategy.js';

const defaultDriverMode = (value =>
	/^(mstp|callback|interval)$/.test(value) ? value : 'interval')(
	QueryString.get('capdriver')
);

const MediaStreamTrackProcessorSupported =
	'MediaStreamTrackProcessor' in window;

export const DRIVER_MODE =
	defaultDriverMode === 'mstp' && MediaStreamTrackProcessorSupported
		? 'mstp'
		: defaultDriverMode === 'callback'
			? 'callback'
			: 'interval';

let driverSuffix = 0;

export class CaptureDriver extends EventTarget {
	#working = false;
	#stream;
	#video;
	#captureReader;
	#captureIntervalId;
	#captureFrameCallbackId;
	#captureDetails;
	#skippedFrames = 0;
	#then;

	constructor(config, stream = null) {
		super();

		this.driverSuffix = ++driverSuffix;
		this.config = config;
		this.#stream = stream;
		this.players = [];
		this.#video = document.createElement('video');

		Promise.all([this.#init(), this.#waitForVideoReady()]).then(() => {
			// custom event triggered by calibration
			this.#video.addEventListener(
				'playback-settings-update',
				this.#startFrameCapture
			);

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

		this.#captureReader = processor.readable.getReader();

		try {
			while (true) {
				const { value: videoFrame, done } = await this.#captureReader.read();
				if (done) break;
				yield videoFrame;
			}
		} catch (err) {
			// do nothing
		} finally {
			this.#captureReader.releaseLock();
		}
	}

	async #updateCaptureDetails() {
		let deviceLabel;
		let trackFps = null;

		try {
			const track = this.#video.srcObject?.getVideoTracks()[0];
			trackFps = track.getSettings().frameRate;
		} catch (err) {
			// ignore 🤷
		}

		this.#captureDetails = {
			device: await getDeviceLabel(this.config.device_id),
			deviceID: this.config.device_id,
			video: this.#video,
			videoSize: `${this.#video.videoWidth} x ${this.#video.videoHeight}`,
			videoFps: trackFps,
			driverMode: DRIVER_MODE,
			ocrClass: (await getOcrClass()).name,
		};

		if (!this.#captureDetails.device) {
			delete this.#captureDetails.device;
			delete this.#captureDetails.deviceID;
		}
	}

	#stopFrameCapture() {
		if (this.#captureReader) {
			this.#captureReader.cancel();
			this.#captureReader = null;
		}

		if (this.#captureIntervalId) timer.clearInterval(this.#captureIntervalId);

		if (this.#captureFrameCallbackId)
			this.#video.cancelVideoFrameCallback(this.#captureFrameCallbackId);
	}

	#startFrameCapture = async () => {
		this.#stopFrameCapture();

		await this.#updateCaptureDetails();

		console.log(
			`#startFrameCapture: ${JSON.stringify(
				{
					requestedDriverMode: defaultDriverMode,
					MediaStreamTrackProcessorSupported,
					videoFps: this.#captureDetails.videoFps,
					diverMode: this.#captureDetails.driverMode,
					ocrClass: this.#captureDetails.ocrClass,
				},
				null,
				2
			)}`
		);

		if (DRIVER_MODE === 'mstp') {
			console.log('Using MediaStreamTrackProcessor in driver');
			for await (const frame of this.#frameGenerator()) {
				try {
					await this.#work(frame);
				} catch (err) {
					console.warn(err);
				}
				frame.close();
			}
		} else if (DRIVER_MODE === 'callback') {
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
		} else if (DRIVER_MODE === 'interval') {
			const frame_rate =
				this.#captureDetails.videoFps || this.config.frame_rate || 30;
			const frame_ms = 1000 / frame_rate; // at ms accuracy, it drifts

			console.log(
				`Using Interval in driver at ${frame_rate}fps (${frame_ms} ms/frame)`
			);

			this.#captureDetails.frameMs = frame_ms;

			this.#captureIntervalId = timer.setInterval(async () => {
				await this.#work();
			}, frame_ms);
		}
	};

	async #work(videoFrame) {
		const now = performance.now();

		if (this.#working) {
			this.#skippedFrames += 1;
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
		await Promise.allSettled(this.players.map(p => p.processFrame(frame)));

		performance.mark(`end-driver-${this.driverSuffix}`);

		const measure = performance.measure(
			`driver-${this.driverSuffix}`,
			`start-driver-${this.driverSuffix}`,
			`end-driver-${this.driverSuffix}`
		);

		this.dispatchEvent(
			new CustomEvent('frame', {
				detail: {
					ts: now,
					skipped: this.#skippedFrames,
					elapsed: measure.duration,
					captureDetails: this.#captureDetails,
				},
			})
		);

		this.#skippedFrames = 0;
		this.#working = false;
	}

	destroy() {
		this.#stopFrameCapture();

		if (this.#stream) {
			this.#stream.getTracks().forEach(track => track.stop());
		}
	}
}
