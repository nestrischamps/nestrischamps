import { NtcComponent } from './NtcComponent.js';

import { html } from '../StringUtils.js';
import { clearConfigAndReset } from '../ConfigUtils.js';

import { getConnectedDevices } from '../MediaUtils.js';

const MARKUP = html`
	<div id="inputs" class="columns container is-fluid">
		<fieldset id="controls" class="column">
			<legend>Controls</legend>

			<div class="field">
				<label class="checkbox">
					Enable Focus Alarm
					<input type="checkbox" class="checkbox" id="focus_alarm" checked />
				</label>
			</div>

			<div class="field">
				<button id="clear_config" class="button is-light">
					Clear config and Restart
				</button>
			</div>

			<div class="field">
				<button id="save_game_palette" class="button is-light" disabled>
					Save Last Game's Palette
				</button>
			</div>

			<div id="timer_control" class="field is-hidden-">
				<button id="start_timer" class="button">Start Timer</button>
				for
				<input type="number" id="minutes" value="120" min="5" max="5949" />
				minutes
			</div>
		</fieldset>

		<fieldset id="privacy" class="column">
			<legend>Privacy / Camera</legend>
			<p>
				<label for="allow_video_feed" class="label">
					Share webcam feed with peerjs
					<input
						type="checkbox"
						class="checkbox"
						id="allow_video_feed"
						checked
					/>
				</label>

				<div class="select">
					<select class="select" id="video_feed_device"></select>
				</div>

				<video width="200" height="150" id="video_feed"></video>
			</p>
			<p>
				<label for="vdo_ninja" class="label">
					OR use vdo.ninja
					<input type="checkbox" class="checkbox" id="vdo_ninja" />
				</label>

				<span id="vdo_ninja_url"></span><br />
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

		window.BULMA_STYLESHEETS.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			focus_alarm: this.shadow.getElementById('focus_alarm'),
			clear_config: this.shadow.getElementById('clear_config'),
			save_game_palette: this.shadow.getElementById('save_game_palette'),
			timer_control: this.shadow.getElementById('timer_control'),
			start_timer: this.shadow.getElementById('start_timer'),
			privacy: this.shadow.getElementById('privacy'),
			allow_video_feed: this.shadow.getElementById('allow_video_feed'),
			video_feed_device: this.shadow.getElementById('video_feed_device'),
			vdo_ninja: this.shadow.getElementById('vdo_ninja'),
			vdo_ninja_url: this.shadow.getElementById('vdo_ninja_url'),
			vdoninja_iframe: this.shadow.getElementById('vdoninja_iframe'),
		};

		this.#domrefs.clear_config.addEventListener('click', clearConfigAndReset);

		this.resetDevices();
	}

	async resetDevices() {
		const { video_feed_device } = this.#domrefs;
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

		video_feed_device.replaceChildren(
			...mappedDevices.map(camera => {
				const camera_option = document.createElement('option');
				camera_option.text = camera.label;
				camera_option.value = camera.deviceId;

				return camera_option;
			})
		);
	}
}

customElements.define('ntc-settings', NTC_Producer_Settings);
