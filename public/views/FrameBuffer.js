import { peek } from '/views/utils.js';

function noop() {}

export default class FrameBuffer {
	constructor(duration_ms = 0, frame_callback = noop) {
		this.duration_ms = duration_ms;
		this.frame_callback = frame_callback;
		this.buffer = [];
		this.frame_to = null;

		this._sendFrame = this._sendFrame.bind(this);
	}

	setFrame(frame) {
		if (this.duration_ms <= 0) {
			this.frame_callback(frame);
			return;
		}

		this.buffer.push(frame);

		if (this.buffer.length == 1) {
			this._reset();
		} else {
			// we have at least 2 frames, check if we need do some rapid replays
			this._maintainRealtime();
		}
	}

	_reset() {
		if (this.buffer.length <= 0) return;

		// record client-local time equivalence
		this.client_time_base = this.buffer[0].ctime;
		this.local_time_base = Date.now() + this.duration_ms;

		this.frame_to = setTimeout(this._sendFrame, this.duration_ms);
	}

	_sendFrame() {
		if (this.buffer.length <= 0) return;

		const frame = this.buffer.shift();

		// send current frame
		this.frame_callback(frame);

		// schedule next frame if needed
		if (this.buffer.length) {
			const next_frame_ctime = this.buffer[0].ctime;
			const elapsed = next_frame_ctime - this.client_time_base;

			this.frame_to = setTimeout(
				this._sendFrame,
				this.local_time_base + elapsed - Date.now()
			);
		}
	}

	_maintainRealtime() {
		/*
		 * If a tab is backgrounded, timers are throttled, when a frame is received, we check if
		 * there's a been a pile up of frames. If there is, we want to replay all frames till we catch up with the buffer size
		 */
		if (this.buffer.length < 2) return;

		const latestClientTime = peek(this.buffer).ctime;

		// batch-send all the "expired" frames that should have already been processed in a non-throttled environment
		while (latestClientTime - this.buffer[0].ctime > this.duration_ms) {
			this._clearFrameTimeout();
			this._sendFrame(); // calling this naively means we set and clear the timeout many times, but it should be negligeable cost
		}
	}

	_clearFrameTimeout() {
		if (!this.frame_to) return;
		this.frame_to = clearTimeout(this.frame_to);
	}

	_destroy() {
		this._clearFrameTimeout();
		this.local_time_base = 0;
		this.client_time_base = 0;
		this.buffer.length = 0;
	}
}
