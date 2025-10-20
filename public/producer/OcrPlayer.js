import { getSerializableConfigCopy } from './ConfigUtils.js';
import { supportsImageType } from './MediaUtils.js';

import { Player } from './Player.js';

import GameTracker from './GameTracker.js';
import { createOCRInstance } from './ocrStrategy.js';

const REMOTE_CALIBRATION_FRAME_INTERVAL_MS = 10000; // ms

async function getRemoteCalibrationImageArgs() {
	const IMAGE_TYPE_PRECEDENCE = [
		{ type: 'image/webp', quality: 0.5 },
		{ type: 'image/jpeg', quality: 0.8 },
	];

	for (const { type, quality } of Object.values(IMAGE_TYPE_PRECEDENCE)) {
		if (await supportsImageType(type)) return [type, quality];
	}

	return ['image/png'];
}

const remoteCalibrationImageArgsPromise = getRemoteCalibrationImageArgs(); // no await

export class OcrPlayer extends Player {
	#ready = false;
	#remoteCalibrationImageArgs;
	#conn = null;
	supportsRemoteCalibration = true;

	constructor(config, num = null) {
		super(config, num);

		this.gameTracker = new GameTracker(config);
		this.gameTracker.addEventListener('frame', this.handleFrame);

		this.API.requestRemoteCalibration = async admin_peer_id => {
			console.log('requestRemoteCalibration', admin_peer_id);

			if (this.#conn) {
				clearInterval(this.#conn.sendVideoFrameIntervalId);
				this.#conn.close();
			}

			const video = this._driver.getVideo();

			const remoteConfig = getSerializableConfigCopy(this.config);

			// strip out fields that should not be shared
			delete remoteConfig.device_id; // this should never be shared - device_id is specific to the local hardware and site

			this.#conn = this.getPeer().connect(admin_peer_id, {
				metadata: {
					video: {
						width: video.videoWidth,
						height: video.videoHeight,
					},
					config: remoteConfig,
					imageArgs: this.#remoteCalibrationImageArgs,
					userAgent: window.navigator.userAgent,
				},
			});

			const sendVideoFrame = async () => {
				console.log('sending remote calibration frame');
				const img = await this.#getVideoFrameAsImgBlob();
				this.#conn.send({ img });
			};

			this.#conn.on('open', () => {
				clearInterval(this.#conn.sendVideoFrameIntervalId);
				this.#conn.sendVideoFrameIntervalId = setInterval(
					sendVideoFrame,
					REMOTE_CALIBRATION_FRAME_INTERVAL_MS
				);
				sendVideoFrame();
			});

			this.#conn.on('data', ({ config }) => {
				for (const [name, task] of Object.entries(config.tasks)) {
					this.config.tasks[name].dirty = true;
					Object.assign(this.config.tasks[name].crop, task.crop);
				}

				// TODO: how to update the controls?
				['brightness', 'contrast'].forEach(prop => {
					if (prop in config) {
						this.config[prop] = config[prop];
					}
				});

				// TODO: carry score7 and reset entire config

				this.config.save();

				this.dispatchEvent(
					new CustomEvent('remote_config_update', { detail: config })
				);
			});

			this.#conn.on('close', () => {
				clearInterval(this.#conn.sendVideoFrameIntervalId);
			});
		};

		// don't remove this, this.ocrPromise is used by the capture component T_T
		this.ocrPromise = createOCRInstance(config);

		// async init
		Promise.all([this.ocrPromise, remoteCalibrationImageArgsPromise]).then(
			([ocr, imageArgs]) => {
				this.#remoteCalibrationImageArgs = imageArgs;

				this.ocr = ocr;
				this.ocr.addEventListener('frame', ({ detail: frame }) => {
					this.gameTracker.processFrame(frame);
				});
				this.connect();
				this.#ready = true;
			}
		);
	}

	// manual async
	#getVideoFrameAsImgBlob() {
		const video = this._driver.getVideo();

		if (!this.remote_calibration_canvas) {
			// lazy initialization of the remote calibration canvas
			this.remote_calibration_canvas = document.createElement('canvas');
			this.remote_calibration_canvas.width = video.videoWidth;
			this.remote_calibration_canvas.height = video.videoHeight;
			this.remote_calibration_canvas_ctx =
				this.remote_calibration_canvas.getContext('2d', { alpha: false });
			this.remote_calibration_canvas_ctx.imageSmoothingEnabled = false;
		}

		// Draw the current video frame into the canvas
		this.remote_calibration_canvas_ctx.drawImage(
			video,
			0,
			0,
			this.remote_calibration_canvas.width,
			this.remote_calibration_canvas.height
		);

		// Convert to webp Blob at 50% quality
		return new Promise(resolve => {
			this.remote_calibration_canvas.toBlob(
				blob => resolve(blob),
				...this.#remoteCalibrationImageArgs
			);
		});
	}

	processFrame(frame) {
		if (!this.#ready) return;

		return this.ocr.processVideoFrame(frame);
	}
}
