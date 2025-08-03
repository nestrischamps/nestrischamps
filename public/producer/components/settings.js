import { NtcComponent } from './NtcComponent.js';

import { html } from '../StringUtils.js';
import { clearConfigAndReset } from '../ConfigUtils.js';

const MARKUP = html`
	<div id="inputs" class="columns container is-fluid">
		<fieldset id="controls" class="column">
			<legend>Controls</legend>

			<div class="field is-horizontal">
				<div class="field-label is-normal">
					<label for="focus_alarm" class="label">Enable Focus Alarm</label>
				</div>
				<div class="field-body">
					<div class="control">
						<input type="checkbox" class="checkbox" id="focus_alarm" checked />
					</div>
				</div>
			</div>

			<div class="field">
				<div class="control">
					<button id="clear_config" class="button is-light">
						Clear config and Restart
					</button>
				</div>
			</div>

			<div class="field">
				<div class="control">
					<button id="save_game_palette" class="button is-light" disabled>
						Save Last Game's Palette
					</button>
				</div>
			</div>
			<div id="timer_control" class="is-hidden">
				<button id="start_timer" class="button">Start Timer</button>
				for
				<input type="number" id="minutes" value="120" min="5" max="5949" />
				minutes
			</div>
		</fieldset>

		<fieldset id="privacy" class="column">
			<legend>Privacy / Camera</legend>
			<p>
				<label for="allow_video_feed">Share webcam feed with peerjs</label>
				<input type="checkbox" id="allow_video_feed" checked /><br />

				<label for="video_feed_device">Webcam</label>
				<select id="video_feed_device"></select
				><br />

				<video width="160" height="120" id="video_feed"></video>
			</p>
			<p>
				<label for="vdo_ninja">OR use vdo.ninja</label>
				<input type="checkbox" id="vdo_ninja" />
				<span id="vdo_ninja_url"></span><br />
				<iframe
					allow="autoplay;camera;microphone;fullscreen;picture-in-picture;display-capture;midi;geolocation;gyroscope;"
					id="vdoninja_iframe"
				></iframe>
			</p>
		</fieldset>
	</div>
`;

export class NTC_Producer_Settings extends NtcComponent {
	#domrefs;

	constructor() {
		super();

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
	}
}

customElements.define('ntc-settings', NTC_Producer_Settings);
