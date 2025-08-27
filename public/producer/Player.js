import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';

import { peerServerOptions } from '/views/constants.js';

import { getSerializableConfigCopy } from './ConfigUtils.js';

import GameTracker from './GameTracker.js';
import { CpuTetrisOCR } from './cpuTetrisOCR.js';
import { WGpuTetrisOCR } from './wgpuTetrisOCR.js';

const send_binary = QueryString.get('binary') !== '0';
const force_cpu = QueryString.get('cpu') === '1';

console.log({ force_cpu });

export class Player extends EventTarget {
	#startTime;
	#lastFrame;
	#connection = null;
	#peer;

	constructor(config, num = null) {
		super();

		this.num = num;
		this.config = config;

		this.#startTime = Date.now();
		this.#lastFrame = { field: [] };

		this.gameTracker = new GameTracker(config);
		this.gameTracker.addEventListener('frame', this.#handleFrame);

		this.ocr =
			navigator.gpu?.requestAdapter && !force_cpu
				? new WGpuTetrisOCR(this.config)
				: new CpuTetrisOCR(this.config);

		this.ocr.addEventListener('frame', ({ detail: frame }) => {
			this.gameTracker.processFrame(frame);
		});

		this.is_player = false;
		this.notice = document.createElement('div');

		this.API = {
			setViewPeerId: _view_peer_id => {
				this.view_peer_id = _view_peer_id;
			},

			makePlayer: (player_index, _view_meta) => {
				this.is_player = true;
				this.view_meta = _view_meta;
				// startSharingVideoFeed();
			},

			dropPlayer() {
				this.is_player = false;
				this.view_meta = null;
				// stopSharingVideoFeed();
			},

			requestRemoteCalibration: async admin_peer_id => {
				console.log('requestRemoteCalibration', admin_peer_id);

				if (this.conn) {
					clearInterval(this.conn.sendWebpIntervalId);
					this.conn.close();
				}

				const video = this._driver.getVideo();

				this.conn = this.#peer.connect(admin_peer_id, {
					metadata: {
						video: {
							width: video.videoWidth,
							height: video.videoHeight,
						},
						config: getSerializableConfigCopy(this.config),
					},
				});

				const sendWebp = async () => {
					const webp = await this.#getVideoFrameAsWebpBlob();
					this.conn.send({ webp });
				};

				this.conn.on('open', () => {
					clearInterval(this.conn.sendWebpIntervalId);
					this.conn.sendWebpIntervalId = setInterval(sendWebp, 10000);
					sendWebp();
				});

				this.conn.on('data', ({ config }) => {
					for (const [name, task] of Object.entries(config.tasks)) {
						Object.assign(this.config.tasks[name].crop, task.crop);
					}

					// TODO: how to update the controls?
					['brightness', 'contrast'].forEach(prop => {
						if (prop in config) this.config[prop] = config[prop];
					});

					// TODO: carry score7 and reset entire config

					this.config.save();
				});

				this.conn.on('close', () => {
					clearInterval(this.conn.sendWebpIntervalId);
				});
			},

			setVdoNinjaURL: () => {},
		};

		this.connect();
	}

	// manua async
	#getVideoFrameAsWebpBlob() {
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

		// Convert to JPEG Blob at 85% quality
		return new Promise(resolve => {
			this.remote_calibration_canvas.toBlob(
				blob => resolve(blob),
				'image/webp',
				0.5 // quality 0..1
			);
		});
	}

	processVideoFrame(frame) {
		this.ocr.processVideoFrame(frame);
	}

	#handleFrame = ({ detail: data }) => {
		if (!this.#connection) return;

		data.game_type = this.config.game_type ?? BinaryFrame.GAME_TYPE.CLASSIC;
		data.ctime = Date.now() - this.#startTime;

		// delete data fields which are never meant to be sent over the wire
		delete data.color1;
		delete data.color2;
		delete data.color3;
		delete data.gym_pause_active;
		delete data.raw;

		// only send frame if changed
		check_equal: do {
			for (let key in data) {
				if (key == 'ctime') continue;
				if (key == 'field') {
					if (!data.field.every((v, i) => this.#lastFrame.field[i] === v)) {
						break check_equal;
					}
				} else if (data[key] != this.#lastFrame[key]) {
					break check_equal;
				}
			}

			// all fields equal, do a sanity check on time
			if (data.ctime - this.#lastFrame.ctime >= 250) break; // max 1 in 15 frames (4fps)

			// no need to send frame
			return;
		} while (false);

		this.#lastFrame = data;

		if (send_binary) {
			this.#connection?.send(BinaryFrame.encode(data));
		} else {
			// convert Uint8Array to normal array so it can be json-encoded properly
			data.field = [...data.field];
			this.#connection?.send(data);
		}
	};

	connect() {
		if (this.#connection) {
			this.#connection.close();
		}

		console.log('Creating Connection');

		if (this.num === null) {
			this.#connection = new Connection();
		} else {
			// multiviewer mode, we connect by static player secret
			const url = new URL(location);
			url.protocol = url.protocol.match(/^https/i) ? 'wss:' : 'ws:';
			url.pathname = `/ws${url.pathname}`.replace(
				/(\/+)?$/,
				`/PLAYER${this.num}`
			);

			console.log(`Using custom url: ${url.toString()}`);

			this.#connection = new Connection(url.toString());
		}

		this.#connection.onMessage = frame => {
			try {
				const [method, ...args] = frame;

				if (this.API.hasOwnProperty(method)) {
					this.API[method](...args);
				} else {
					console.log(`Command ${method} received but not supported`);
				}
			} catch (e) {
				console.log(`Could not process command ${frame[0]}`);
				console.error(e);
			}
		};

		this.#connection.onKicked = reason => {
			this.resetNotice();
			this.notice.classList.add('error');
			this.notice.textContent = `WARNING! The connection has been kicked because [${reason}]. The page will NOT attempt to reconnect.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onBreak = () => {
			this.resetNotice();
			this.notice.classList.add('warning');
			this.notice.textContent = `WARNING! The page is disconnected. It will try to reconnect automatically.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onResume = this.resetNotice;

		this.#connection.onInit = () => {
			if (this.#peer) {
				this.#peer.removeAllListeners();
				this.#peer.destroy();
				this.#peer = null;
			}
			this.#peer = new Peer(this.#connection.id, peerServerOptions);
			this.#peer.on('open', err => {
				console.log(Date.now(), 'peer opened', this.#peer.id);
				//startSharingVideoFeed();
			});
			this.#peer.on('error', err => {
				console.log(`Peer error: ${err.message}`);
				this.#peer.retryTO = clearTimeout(this.#peer.retryTO); // there should only be one retry scheduled
				// this.#peer.retryTO = setTimeout(startSharingVideoFeed, 1500); // we assume this will succeed at some point?? 😰😅
			});
		};

		return this.#connection;
	}

	resetNotice = () => {};
}
