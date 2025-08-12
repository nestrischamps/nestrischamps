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

		performance.mark(`start`);

		this.capture_context.filter = this.#getCanvasFilters();
		this.capture_context.drawImage(
			videoFrame || this.video,
			0,
			0,
			width,
			height
		);

		performance.mark(`draw`);

		this.capture_context.filter = 'none';
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

		performance.mark(`extract`);

		this.capture_context.fillStyle = '#FFA50080';

		this.configData.fields.forEach(name => {
			const task = this.config.tasks[name];

			this.capture_context.fillRect(
				task.crop.x,
				task.crop.y,
				task.crop.w,
				task.crop.h
			);
		});

		performance.mark(`highlight`);

		performance.measure('draw', `start`, `draw`);
		performance.measure('extract', `draw`, `extract`);
		performance.measure('highlight', `extract`, `highlight`);
	}

	#getCanvasFilters() {
		const filters = [];

		if (this.config.brightness > 1) {
			filters.push(`brightness(${this.config.brightness})`);
		}

		if (this.config.contrast !== 1) {
			filters.push(`contrast(${this.config.contrast})`);
		}

		return filters.length ? filters.join(' ') : 'none';
	}

	async #doOCR() {}

	getDigit(pixel_data, max_check_index, is_red) {
		const sums = new Float64Array(max_check_index);
		const size = pixel_data.length >>> 2;
		const red_scale = 255 / 155; // scale red values as if capped at 155

		for (let p_idx = size; p_idx--; ) {
			const offset_idx = p_idx << 2;
			const pixel_luma = is_red
				? Math.min(pixel_data[offset_idx] * red_scale, 255) // only consider red component for luma, with scaling and capped
				: luma(
						pixel_data[offset_idx],
						pixel_data[offset_idx + 1],
						pixel_data[offset_idx + 2]
					);

			for (let t_idx = max_check_index; t_idx--; ) {
				const diff = pixel_luma - this.templates[t_idx][p_idx];
				sums[t_idx] += diff * diff;
			}
		}

		let min_val = 0xffffffff;
		let min_idx = -1;

		for (let s_idx = sums.length; s_idx--; ) {
			if (sums[s_idx] < min_val) {
				min_val = sums[s_idx];
				min_idx = s_idx;
			}
		}

		return min_idx;
	}
}
