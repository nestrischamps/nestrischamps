import { CONFIGS, TASK_RESIZE } from './constants.js';

export class TetrisOCR extends EventTarget {
	constructor(config) {
		super();

		this.configData = Object.values(CONFIGS).find(
			conf => conf.game_type === config.game_type
		);

		if (!this.configData) {
			throw new Error('Unable to find config data');
		}

		this.setConfig(config);

		this.capture_canvas = document.createElement('canvas');
		this.capture_canvas.id = 'capture_canvas';
		this.capture_canvas._ntc_initialized = false;

		this.output_canvas = document.createElement('canvas');
		this.output_canvas.id = 'output_canvas';
		this.output_canvas.width = this.configData.packing.size.w;
		this.output_canvas.height = this.configData.packing.size.h;
	}

	setConfig(config) {
		this.config = config;
		this.palette = this.palettes?.[config.palette]; // will reset to undefined when needed

		this.pending_capture_reinit = true;

		for (const [name, task] of Object.entries(this.config.tasks)) {
			let resize_tuple;

			if (name === 'score' && config.score7) {
				resize_tuple = TASK_RESIZE.score7;
			} else {
				resize_tuple = TASK_RESIZE[name];
			}

			const canvas = document.createElement('canvas');
			canvas.width = resize_tuple.w;
			canvas.height = resize_tuple.h;

			task.canvas = canvas;
			task.packing_pos = this.configData.packing.positions[name];
		}
	}

	async processVideoFrame() {
		throw new Error('processVideoFrame(): child class to implement');
	}
}
