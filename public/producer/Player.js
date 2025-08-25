import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';

import { peerServerOptions } from '/views/constants.js';

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

			requestRemoteCalibration: admin_peer_id => {
				console.log('requestRemoteCalibration', admin_peer_id);
				this.#peer.call(admin_peer_id, this._driver.getVideo().srcObject, {
					config: { foo: [1, 5, 8] },
				});
				// makes a call to admin caller and pass config
				// need access to driver
			},

			setVdoNinjaURL: () => {},
		};

		this.connect();
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
