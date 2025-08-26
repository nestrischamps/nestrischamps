import QueryString from '/js/QueryString.js';
import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { clearConfigAndReset } from '../ConfigUtils.js';
import { getConnectedDevices } from '../MediaUtils.js';

const MARKUP = html`
	<div id="inputs" class="columns container is-fluid">
		<fieldset id="controls" class="column">
			<legend>Controls</legend>

			<div class="field">
				<label class="checkbox" for="focus_alarm">
					Enable Focus Alarm
					<input type="checkbox" class="checkbox" id="focus_alarm" checked />
				</label>
			</div>

			<div class="field">
				<button id="clear_config" class="button is-light">
					Clear Config and Restart
				</button>
			</div>

			<div class="field">
				<button id="save_game_palette" class="button is-light" disabled>
					Save Last Game's Palette
				</button>
			</div>

			<div id="timer_control" class="field is-hidden">
				<button id="start_timer" class="button">Start Timer</button>
				for
				<input type="number" id="minutes" value="120" min="5" max="5949" />
				minutes
			</div>
		</fieldset>

		<fieldset id="privacy" class="column">
			<legend>Privacy / Camera</legend>
			<p>
				<div class="field">
					<label for="allow_video_feed" class="checkbox">
						Share webcam feed with peerjs
						<input
							type="checkbox"
							class="checkbox"
							id="allow_video_feed"
							checked
						/>
					</label>
				</div>

				<div class="select">
					<select id="video_feed_selector"></select>
				</div>
				<br />
				<video width="200" height="150" id="video_feed"></video>
			</p>
			<p>
				<div class="field">
					<label class="checkbox">
						OR use vdo.ninja
						<input type="checkbox" class="checkbox" id="vdo_ninja" />
					</label>
				</div>
				<div id="vdo_ninja_url"></div>
				<br />
				<iframe
					allow="autoplay;camera;microphone;fullscreen;picture-in-picture;display-capture;midi;geolocation;gyroscope;"
					id="vdoninja_iframe"
				></iframe>
			</p>
		</fieldset>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	#vdoninja_iframe {
		width: 100%;
		height: 30em;
	}
`);

export class NTC_Producer_Settings extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;
		this.style.display = 'block';

		this.#domrefs = {
			focus_alarm: this.shadow.getElementById('focus_alarm'),
			clear_config: this.shadow.getElementById('clear_config'),
			save_game_palette: this.shadow.getElementById('save_game_palette'),
			timer_control: this.shadow.getElementById('timer_control'),
			start_timer: this.shadow.getElementById('start_timer'),
			privacy: this.shadow.getElementById('privacy'),

			allow_video_feed: this.shadow.getElementById('allow_video_feed'),
			video_feed_selector: this.shadow.getElementById('video_feed_selector'),
			video_feed: this.shadow.getElementById('video_feed'),

			vdo_ninja: this.shadow.getElementById('vdo_ninja'),
			vdo_ninja_url: this.shadow.getElementById('vdo_ninja_url'),
			vdoninja_iframe: this.shadow.getElementById('vdoninja_iframe'),
		};

		this.#domrefs.focus_alarm.addEventListener(
			'change',
			this.#onFocusAlarmChange
		);
		this.#domrefs.clear_config.addEventListener('click', clearConfigAndReset);
		this.#domrefs.video_feed_selector.addEventListener(
			'change',
			this.#playDevice
		);
		this.#domrefs.allow_video_feed.addEventListener(
			'change',
			this.#onAllowVideoFeedChange
		);
		this.#domrefs.vdo_ninja.addEventListener('change', this.#onVdoNinjaChange);

		if (QueryString.get('timer') === '1') {
			this.#domrefs.timer_control.classList.remove('is_hidden');
		}

		this.resetDevices();
	}

	async resetDevices() {
		const { video_feed_selector } = this.#domrefs;
		const devicesList = await getConnectedDevices('videoinput');

		const mappedDevices = devicesList.map(camera => {
			const device = { label: camera.label, deviceId: camera.deviceId };

			// Drop the manufacturer:make identifier because it's (typically) not useful
			device.label = device.label.replace(
				/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/,
				''
			);

			return device;
		});

		video_feed_selector.replaceChildren(
			...[{ label: '-', deviceId: 'default' }, ...mappedDevices].map(camera => {
				const camera_option = document.createElement('option');
				camera_option.text = camera.label;
				camera_option.value = camera.deviceId;

				return camera_option;
			})
		);
	}

	#onFocusAlarmChange = () => {
		const { focus_alarm } = this.#domrefs;

		if (focus_alarm.checked) {
		} else {
		}
	};

	#playDevice = async () => {
		const { video_feed, video_feed_selector } = this.#domrefs;

		const video_constraints = {
			width: { ideal: 320 },
			height: { ideal: 240 },
			frameRate: { ideal: 15 }, // players hardly move... no need high fps?
		};

		// TODO: get from connection somehow?
		const m = (this.view_meta?._video || '').match(/^(\d+)x(\d+)$/);

		if (m) {
			video_constraints.width.ideal = parseInt(m[1], 10);
			video_constraints.height.ideal = parseInt(m[2], 10);
		}

		if (video_feed_selector.value === 'default') {
			delete video_constraints.deviceId;
		} else {
			video_constraints.deviceId = { exact: video_feed_selector.value };
		}

		console.log(Date.now(), 'Probing for cam feed');

		const stream = await navigator.mediaDevices.getUserMedia({
			audio: QueryString.get('webcam_audio') === '1',
			video: video_constraints,
		});

		video_feed.srcObject = stream;
		video_feed.play();
	};

	#onAllowVideoFeedChange = () => {
		const { allow_video_feed, video_feed, vdo_ninja } = this.#domrefs;

		if (allow_video_feed.checked) {
			this.#playDevice();

			vdo_ninja.checked = false;
			this.#onVdoNinjaChange();
		} else {
			video_feed.pause();
			video_feed.srcObject?.getTracks().forEach(track => track.stop());
			video_feed.srcObject = null;
		}
	};

	#onVdoNinjaChange = () => {
		const { allow_video_feed, vdo_ninja, vdoninja_iframe, vdo_ninja_url } =
			this.#domrefs;

		if (vdo_ninja.checked) {
			// 1. start up vdo ninja
			const chars =
				'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(
					''
				);
			const streamid = `_NTC_${Array(8)
				.fill()
				.map(() => chars[Math.floor(Math.random() * chars.length)])
				.join('')}`;

			const pushURL = new URL('https://vdo.ninja/');
			pushURL.searchParams.set('push', streamid);
			pushURL.searchParams.set('transparent', 0);
			pushURL.searchParams.set('webcam', 1);
			pushURL.searchParams.set('audiodevice', 0);
			pushURL.searchParams.set('autostart', 1);
			pushURL.searchParams.set('easyexit', 1);

			vdoninja_iframe.src = pushURL.toString();

			const viewURL = new URL('https://vdo.ninja/');
			viewURL.searchParams.set('view', streamid);
			viewURL.searchParams.set('cover', 1);
			viewURL.searchParams.set('transparent', 0);

			// connection.send(['setVdoNinjaURL', viewURL]);
			const a = document.createElement('a');
			a.href = a.textContent = viewURL.toString();

			a.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				navigator.clipboard.writeText(viewURL.toString());

				vdo_ninja_url.querySelectorAll('div').forEach(s => s.remove());

				const div = document.createElement('div');
				div.innerHTML = `<i>(URL has been copied to clipboard)</i>`;

				vdo_ninja_url.append(div);

				setTimeout(() => div.remove(), 1000);
			});

			vdo_ninja_url.replaceChildren(a);
			a.click();

			// 2. cancel peerjs video
			allow_video_feed.checked = false;
			this.#onAllowVideoFeedChange();
		} else {
			vdoninja_iframe.src = '';
			vdo_ninja_url.textContent = '';
		}
	};
}

customElements.define('ntc-settings', NTC_Producer_Settings);
