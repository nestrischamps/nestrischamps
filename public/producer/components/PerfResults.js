import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`<dl id="perf_data"></dl>`;
const STAT_NUM_SAMPLES = 3600; // 1 minute worth at 60fps; 3mins worth at 30fps

function sortByDriverAndPlayerReverse(k1, k2) {
	const isDriver1 = !k1.includes('process');
	const isDriver2 = !k2.includes('process');

	if (isDriver1 && !isDriver2) return 1;
	if (!isDriver1 && isDriver2) return -1;

	// Both driver or both player
	// no need to test for equality, since there cannot be duplicates
	return k1 < k2 ? 1 : -1;
}

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
    :host {
        display: block
    }
`);

export class NTC_PerfResults extends NtcComponent {
	#domrefs;
	#stats;
	#last_perf = {};
	#dompairs = new Map();

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.#stats = {};

		this.#domrefs = {
			perf_data: this.shadow.getElementById('perf_data'),
		};

		setInterval(this.#reorder, 10000);
	}

	#doShowPerfData() {
		const { perf_data } = this.#domrefs;

		for (const [name, value] of Object.entries(this.#last_perf)) {
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

				perf_data.appendChild(dt);
				perf_data.appendChild(dd);

				this.#dompairs.set(name, { dt, dd });
			}
		}
	}

	#reorder = () => {
		const { perf_data } = this.#domrefs;

		// TODO: force clean order of more of the known metrics 😢 (e.g. driver total, player total, etc.)
		// For now, we push the driver metrics on top, since that's the most important total
		[...this.#dompairs.keys()]
			.filter(key => /(driver|processVideoFrame)-\d+/.test(key))
			.sort(sortByDriverAndPlayerReverse) // reverse because we insert by prepend
			.forEach(key => {
				const { dt, dd } = this.#dompairs.get(key);

				perf_data.prepend(dd);
				perf_data.prepend(dt);
			});
	};

	showPerfData() {
		const perf = {};

		performance.getEntriesByType('measure').forEach(m => {
			// discard browser performance measurements -_-
			if (m.name.startsWith('browser::')) return;
			if (m.name.startsWith('invoke-')) return;
			if (m.name.startsWith('inline-')) return;
			if (m.name.startsWith('DOM-')) return;
			if (m.name.startsWith('ANALYZE_')) return;

			if (!this.#stats[m.name]) {
				this.#stats[m.name] = new SlidingWindowStats(STAT_NUM_SAMPLES);
			}

			const stats = this.#stats[m.name];

			stats.push(m.duration);

			perf[m.name] =
				stats.ewma.toFixed(1) +
				` | last${STAT_NUM_SAMPLES}(` +
				`avg:${stats.avg.toFixed(1)}` +
				` - max:${stats.max.toFixed(1)}` +
				')';
		});

		// 2. store data
		this.#last_perf = perf;

		// 3. update display
		this.#doShowPerfData();
	}
}

customElements.define('ntc-perfresults', NTC_PerfResults);

// Exact sliding min, max, avg over the last N.
// Also tracks a global EWMA, and a global totalCount.
// O(1) per push, O(N) memory, no GC churn.
class SlidingWindowStats {
	constructor(size = 1000, { emaAlpha = 0.1 } = {}) {
		if (size <= 0) throw new Error('size must be > 0');
		if (!(emaAlpha > 0 && emaAlpha <= 1))
			throw new Error('emaAlpha must be in (0, 1]');
		this.size = size;

		// Average over window
		this.buf = new Float64Array(size);
		this.bufPos = 0;
		this.count = 0;
		this.sum = 0;
		this.latestValue = NaN;

		// Global sample index, doubles as totalCount
		this.i = 0;

		// Monotonic max deque: values decreasing from head to tail
		this.qMaxI = new Int32Array(size);
		this.qMaxV = new Float64Array(size);
		this.qMaxHead = 0;
		this.qMaxTail = 0;

		// Global EWMA
		this.ewmaAlpha = emaAlpha;
		this._ewma = NaN; // set to first sample on first push
	}

	// Push a new sample x into the window and global EWMA.
	push(x) {
		const prevTotal = this.i; // number of samples before this push
		const idx = this.i++; // index for this sample
		this.latestValue = x;
		const cap = this.size;
		const cutoff = idx - cap;

		// Expire old candidates by index (front)
		while (
			this.qMaxHead < this.qMaxTail &&
			this.qMaxI[this.qMaxHead % cap] <= cutoff
		) {
			this.qMaxHead++;
		}

		// Insert into qMax: drop worse-or-equal from back
		while (this.qMaxHead < this.qMaxTail) {
			const last = (this.qMaxTail - 1) % cap;
			if (this.qMaxV[last] <= x) this.qMaxTail--;
			else break;
		}
		this.qMaxI[this.qMaxTail % cap] = idx;
		this.qMaxV[this.qMaxTail % cap] = x;
		this.qMaxTail++;

		// Window average via circular buffer
		if (this.count < cap) {
			this.buf[this.bufPos] = x;
			this.bufPos = (this.bufPos + 1) % cap;
			this.sum += x;
			this.count++;
		} else {
			const old = this.buf[this.bufPos];
			this.buf[this.bufPos] = x;
			this.bufPos = (this.bufPos + 1) % cap;
			this.sum += x - old;
		}

		// Global EWMA, independent of the window
		if (prevTotal === 0 || Number.isNaN(this._ewma)) {
			this._ewma = x;
		} else {
			const a = this.ewmaAlpha;
			this._ewma += a * (x - this._ewma);
		}
	}

	// Current stats (NaN when window is empty).
	get latest() {
		return this.latestValue;
	}
	get max() {
		return this.count ? this.qMaxV[this.qMaxHead % this.size] : NaN;
	}
	get avg() {
		return this.count ? this.sum / this.count : NaN;
	}
	get length() {
		return this.count;
	}

	// Global counters and smoothers
	get totalCount() {
		return this.i;
	} // all samples since last reset
	get ewma() {
		return this._ewma;
	} // biased EWMA
	get ewmaDebiased() {
		// optional debiased EWMA
		const t = this.i;
		if (!t || Number.isNaN(this._ewma)) return NaN;
		const a = this.ewmaAlpha;
		const oneMinus = 1 - a;
		const z = 1 - Math.pow(oneMinus, t);
		return z > 0 ? this._ewma / z : this._ewma;
	}

	setEwmaAlpha(alpha, { reinit = false } = {}) {
		if (!(alpha > 0 && alpha <= 1)) throw new Error('alpha must be in (0, 1]');
		this.ewmaAlpha = alpha;
		if (reinit) this._ewma = NaN; // next push seeds from that sample
	}

	reset() {
		this.buf.fill(0);
		this.bufPos = 0;
		this.count = 0;
		this.sum = 0;
		this.latestValue = NaN;
		this.i = 0;
		this.qMaxHead = this.qMaxTail = 0;
		this._ewma = NaN;
	}
}
