import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { getOcrClass } from '../ocrStrategy.js';

const MARKUP = html`<dl id="data"></dl>`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
    :host {
        display: block
    }
`);

export class NTC_CaptureDetails extends NtcComponent {
	#domrefs;
	#stats;
	#dompairs = new Map();

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.#stats = new FrameStats();

		this.#domrefs = {
			data: this.shadow.getElementById('data'),
		};
	}

	#showDlItems(details) {
		const { data } = this.#domrefs;

		for (const [name, value] of Object.entries(details)) {
			const pair = this.#dompairs.get(name);

			if (pair) {
				const { dt, dd } = pair;
				if (value === null) {
					dd.remove();
					dt.remove();
				} else {
					dd.textContent = value;
				}
			} else if (value !== null) {
				const dt = document.createElement('dt');
				const dd = document.createElement('dd');

				dt.classList.add(name);
				dt.textContent = name;
				dd.textContent = value;

				data.appendChild(dt);
				data.appendChild(dd);

				this.#dompairs.set(name, { dt, dd });
			}
		}
	}

	showCaptureDetails({ detail }) {
		// showCaptureDetails is always called with data
		while (detail.skipped-- > 0) {
			this.#stats.addSkipped(detail.ts);
		}

		this.#stats.addProcessed(detail.ts);

		const ss = this.#stats.snapshot();

		const data = {
			...detail.captureDetails,
			'effective-fps': ss.last60s.effectiveFps.toFixed(2),
			'skipped-frames-60s': `${ss.last60s.skipped} / ${ss.last60s.processed} (${(100 * ss.last60s.skipRate).toFixed(2)}%)`,
			'skipped-frames-5mins': `${ss.last5m.skipped} / ${ss.last5m.processed} (${(100 * ss.last5m.skipRate).toFixed(2)}%)`,
		};

		delete data.video;

		this.#showDlItems(data);
	}
}

customElements.define('ntc-capturedetails', NTC_CaptureDetails);

class SlidingWindowCounter {
	#windowMs;
	#times = [];

	constructor(windowMs) {
		this.#windowMs = windowMs;
	}

	add(t) {
		this.#times.push(t);
		this.#prune(t);
	}

	count(now) {
		this.#prune(now);
		return this.#times.length;
	}

	#prune(now) {
		const cutoff = now - this.#windowMs;
		// Remove from front while too old
		let i = 0;
		const arr = this.#times;
		while (i < arr.length && arr[i] < cutoff) i++;
		if (i > 0) arr.splice(0, i);
	}
}

class FrameStats {
	// Lifetime
	#processedTotal = 0;
	#skippedTotal = 0;

	#startTime = null;

	// Rolling windows
	#proc60 = new SlidingWindowCounter(60_000);
	#skip60 = new SlidingWindowCounter(60_000);
	#proc5m = new SlidingWindowCounter(5 * 60_000);
	#skip5m = new SlidingWindowCounter(5 * 60_000);

	addProcessed(t) {
		if (this.#startTime === null) this.#startTime = t;
		this.#processedTotal++;
		this.#proc60.add(t);
		this.#proc5m.add(t);
	}

	addSkipped(t) {
		if (this.#startTime === null) this.#startTime = t;
		this.#skippedTotal++;
		this.#skip60.add(t);
		this.#skip5m.add(t);
	}

	snapshot() {
		const t = performance.now(); // use performance.now for monotonic time
		const p60 = this.#proc60.count(t);
		const s60 = this.#skip60.count(t);
		const p5 = this.#proc5m.count(t);
		const s5 = this.#skip5m.count(t);
		const pAll = this.#processedTotal;
		const sAll = this.#skippedTotal;

		const ratio = (p, s) => (p + s === 0 ? 0 : s / (p + s));

		const elapsed = this.#startTime !== null ? t - this.#startTime : 0;
		const eFps = (p, s, windowLimit) => {
			if (!elapsed) return 0;
			const windowElapsed = Math.min(elapsed, windowLimit);
			return windowElapsed > 0 ? ((p + s) * 1000) / windowElapsed : 0;
		};

		return {
			lifetime: {
				processed: pAll,
				skipped: sAll,
				skipRate: ratio(pAll, sAll),
				effectiveFps: eFps(pAll, sAll, elapsed),
			},
			last60s: {
				processed: p60,
				skipped: s60,
				skipRate: ratio(p60, s60),
				effectiveFps: eFps(p60, s60, 60_000),
			},
			last5m: {
				processed: p5,
				skipped: s5,
				skipRate: ratio(p5, s5),
				effectiveFps: eFps(p5, s5, 5 * 60_000),
			},
		};
	}
}
