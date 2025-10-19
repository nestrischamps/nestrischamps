import { Player } from './Player.js';

import EDClient from '/ocr/EDClient.js';
import EDGameTracker from '/ocr/EDGameTracker.js';

export class EverdrivePlayer extends Player {
	#edClient;

	constructor(config, num = null) {
		super(config, num);

		this.gameTracker = new EDGameTracker();
		this.#edClient = new EDClient(config.frame_rate || 60);

		this.#edClient.addEventListener('frame', event => {
			this.gameTracker.setData(event.detail.data);
		});

		this.gameTracker.addEventListener('frame', this.handleFrame);

		this.connect();
	}
}
