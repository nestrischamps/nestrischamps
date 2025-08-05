import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="room">
		<div class="controls container mt-5 has-text-centered">
			<button class="button is-success" id="setReady">Set Ready</button>
			<button class="button is-danger" id="notReady">Not Ready</button>
		</div>
		<div class="view"></div>
	</div>
`;

export class NTC_Producer_RoomView extends NtcComponent {
	#domrefs;
	#roomIFrame;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			setReady: this.shadow.getElementById('setReady'),
			notReady: this.shadow.getElementById('notReady'),
			view: this.shadow.getElementById('view'),
		};
	}

	loadRoomView() {
		if (!is_match_room) {
			console.warn('View in private room is not supported');
			return;
		}

		const view_url = this.getViewURL();

		if (this.#roomIFrame) {
			if (this.#roomIFrame.getAttribute('src') === view_url) return; // same view, nothing to do

			// there's already an iframe, but we need to reload the correct layout
			// clear first and fall through
			this.destroyRoomView();
		}

		const iFrameStyles = {
			border: 0,
			margin: 'auto',
			transformOrigin: `0 0`,
		};

		this.#roomIFrame = document.createElement('iframe');
		Object.assign(this.#roomIFrame.style, iFrameStyles);
		this.#roomIFrame.setAttribute('src', view_url);

		if (view_meta?._size === '720') {
			this.#roomIFrame.setAttribute('width', 1280);
			this.#roomIFrame.setAttribute('height', 720);
		} else if (view_meta?._size === '750') {
			this.#roomIFrame.setAttribute('width', 1334);
			this.#roomIFrame.setAttribute('height', 750);
		} else {
			this.#roomIFrame.setAttribute('width', 1920);
			this.#roomIFrame.setAttribute('height', 1080);
		}

		this.resizeRoomIFrame();

		this.#domrefs.view.appendChild(this.#roomIFrame);

		window.addEventListener('resize', resizeRoomIFrame);
	}

	resizeRoomIFrame = () => {
		if (!this.#roomIFrame) return;

		const size =
			view_meta?._size === '720'
				? 1280
				: view_meta?._size === '750'
					? 1334
					: 1920;

		if (room.clientWidth >= size) {
			if (!this.#roomIFrame.style.transform) return;
			this.#roomIFrame.style.transform = null;
		} else {
			const scale = room.clientWidth / size;
			this.#roomIFrame.style.transform = `scale(${scale})`;
		}
	};

	getLayout(layout) {
		return layout && /^[a-z0-9_]+$/.test(layout) ? layout : null;
	}

	getViewURL() {
		const producer_url = new URL(document.location);
		const searchParams = new URLSearchParams();

		let mainViewLayout;

		if (view_meta) {
			mainViewLayout = this.getLayout(view_meta._layout);

			// add remote view settings (all except private keys)
			Object.entries(view_meta)
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

	destroyRoomView() {
		this.#roomIFrame.remove();
		window.removeEventListener('resize', resizeRoomIFrame);
		this.#roomIFrame = null;
	}
}

customElements.define('ntc-roomview', NTC_Producer_RoomView);
