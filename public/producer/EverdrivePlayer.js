import { Player } from './Player.js';

import EDGameTracker from './EDGameTracker.js';

export class EverdrivePlayer extends Player {
	constructor(config, num = null) {
		super(config, num);

		this.gameTracker = new EDGameTracker();
		this.gameTracker.addEventListener('frame', this.handleFrame);

		this.connect();
	}

	processFrame(frameBuffer) {
		return this.gameTracker.processFrame(frameBuffer);
	}
}
