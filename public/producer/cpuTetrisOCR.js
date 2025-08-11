import { TetrisOCR } from './TetrisOCR.js';

export class CpuTetrisOCR extends TetrisOCR {
	constructor(stream, config) {
		super(stream, config);

		this.capture_context = this.capture_canvas.getContext('2d', {
			willReadFrequently: true,
		});
	}

	setConfig(config) {
		super.setConfig(config);

		for (const task of Object.values(this.all_tasks)) {
			task.canvas_ctx = task.canvas.getContext('2d', {
				willReadFrequently: true,
			});
		}
	}

	async processVideoFrame(videoFrame) {
		const { width, height } = this.capture_canvas;

		this.capture_context.drawImage(
			videoFrame || this.video,
			0,
			0,
			width,
			height
		);

		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];
			task.canvas_ctx.drawImage(
				this.capture_canvas,
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h,
				0,
				0,
				task.canvas.width,
				task.canvas.height
			);
		});
	}
}
