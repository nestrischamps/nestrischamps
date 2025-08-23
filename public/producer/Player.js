import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';

import GameTracker from './GameTracker.js';
import { CpuTetrisOCR } from './cpuTetrisOCR.js';
import { WGpuTetrisOCR } from './wgpuTetrisOCR.js';

export class Player extends EventTarget {
	#startTime;
	#lastFrame;
	#connection = null;

	constructor(num, config) {
		super();

		this.num = num;
		this.config = config;

		this.#startTime = Date.now();
		this.#lastFrame = { field: [] };

		this.gameTracker = new GameTracker(config);
		this.gameTracker.addEventListener('frame', this.#handleFrame);

		this.ocr = navigator.gpu?.requestAdapter
			? new WGpuTetrisOCR(this.config)
			: new CpuTetrisOCR(this.config);

		this.ocr.addEventListener('frame', ({ detail: frame }) => {
			// this.gameTracker.processFrame(frame);
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
}
