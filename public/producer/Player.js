export class Player extends EventTarget {
	constructor(config, driver) {
		super();

		this.config = config;
		driver.addCapture(this);

		const ocr = new CpuTetrisOCR(config);
		const gameTracker = new GameTracker(config);
	}

	processVideoFrame() {}
}
