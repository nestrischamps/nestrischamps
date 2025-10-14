import { Player } from './Player.js';

import EDClient from '/ocr/EDClient.js';
import EDGameTracker from '/ocr/EDGameTracker.js';

export class EverdrivePlayer extends Player {
	#edClient;

	constructor(config, num = null) {
		super(config, num);

		this.gameTracker = new EDGameTracker();
		this.#edClient = new EDClient(config.frame_rate || 60);

		this.#edClient.onData = this.gameTracker.setData;
		this.gameTracker.onFrame = data => {
			this.handleFrame({ detail: data });
		};

		this.connect();
	}
}
