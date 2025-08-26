import QueryString from '/js/QueryString.js';
import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="room">
		<div class="controls container mt-5 mb-4 has-text-centered">
			<button class="button is-success" id="setReady">Set Ready</button>
			<button class="button is-danger" id="notReady">Not Ready</button>
		</div>
		<div id="view"></div>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	:host {
		display: block
	}
`);

export class NTC_Producer_RoomView extends NtcComponent {
	#domrefs;
	#roomIFrame;
	#observer;
	#destroyIframeTO;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			setReady: this.shadow.getElementById('setReady'),
			notReady: this.shadow.getElementById('notReady'),
			view: this.shadow.getElementById('view'),
		};

		this.#observer = new IntersectionObserver(this.#observerCallBack);
	}

	connectedCallback() {
		this.#observer.observe(this);
	}

	disconnectedCallback() {
		this.#observer.disconnect();
	}

	#observerCallBack = (entries, observer) => {
		this.#destroyIframeTO = clearTimeout(this.#destroyIframeTO);

		entries.forEach(entry => {
			if (entry.isIntersecting) {
				console.log('Room is visible!');
				this.#loadRoomView();
			} else {
				console.log('Room is not visible.');
				this.#destroyIframeTO = setTimeout(this.#destroyRoomView, 15000); // 15 seconds to allow users to click around
			}
		});
	};

	#loadRoomView() {
		const view_url = this.#getViewURL();

		if (this.#roomIFrame) {
			if (this.#roomIFrame.getAttribute('src') === view_url) {
				// same view, nothing to
				console.log(`iframe is already loaded correctly`);
				return;
			}

			// there's already an iframe, but we need to reload the correct layout
			// clear first and fall through
			console.log(`Clearing old iframe`);
			this.#destroyRoomView();
		}

		const iFrameStyles = {
			border: 0,
			margin: 'auto',
			transformOrigin: `0 0`,
		};

		this.#roomIFrame = document.createElement('iframe');
		Object.assign(this.#roomIFrame.style, iFrameStyles);
		this.#roomIFrame.setAttribute('src', view_url);

		const size =
			this.view_meta?._size === '720'
				? { w: 1280, h: 720 }
				: this.view_meta?._size === '750'
					? { w: 1334, h: 750 }
					: { w: 1920, h: 1080 };

		this.#roomIFrame.setAttribute('width', size.w);
		this.#roomIFrame.setAttribute('height', size.h);

		this.#domrefs.view.appendChild(this.#roomIFrame);

		window.addEventListener('resize', this.#resizeRoomIFrame);
		this.#resizeRoomIFrame();
	}

	#resizeRoomIFrame = () => {
		if (!this.#roomIFrame) return;

		const size =
			this.view_meta?._size === '720'
				? 1280
				: this.view_meta?._size === '750'
					? 1334
					: 1920;

		if (this.clientWidth >= size) {
			if (!this.#roomIFrame.style.transform) return;
			this.#roomIFrame.style.transform = null;
		} else {
			const scale = this.clientWidth / size;
			this.#roomIFrame.style.transform = `scale(${scale})`;
		}
	};

	#getLayout(layout) {
		return layout && /^[a-z0-9_]+$/.test(layout) ? layout : null;
	}

	#getViewURL() {
		const producer_url = new URL(document.location);
		const searchParams = new URLSearchParams();

		let mainViewLayout;

		if (false && this.view_meta) {
			mainViewLayout = this.#getLayout(this.view_meta._layout);

			// add remote view settings (all except private keys)
			Object.entries(this.view_meta)
				.filter(([key, _]) => !key.startsWith('_'))
				.forEach(([key, value]) => searchParams.set(key, value));
		}

		const newPathname = producer_url.pathname.replace(
			/\/producer2?$/,
			`/view/${mainViewLayout || 'ctwc23'}`
		);

		// add specific settings
		searchParams.set('tetris_sound', 0);
		searchParams.set('video', 0);
		searchParams.set('bg', 0);
		searchParams.set('simultris', 0);
		searchParams.set('srabbit', 0);
		// disable commentator bot, unless the player has specifically activated it
		searchParams.set('combot', QueryString.get('combot') === '1' ? '1' : '0');
		searchParams.set('in_producer', 1);

		return `${producer_url.origin}${newPathname}?${searchParams}`;
	}

	#destroyRoomView = () => {
		if (!this.#roomIFrame) return;
		console.log(`Removing room iframe`);
		this.#roomIFrame.remove();
		window.removeEventListener('resize', this.#resizeRoomIFrame);
		this.#roomIFrame = null;
	};
}

customElements.define('ntc-roomview', NTC_Producer_RoomView);
