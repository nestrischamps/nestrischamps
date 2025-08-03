import { html } from '../StringUtils.js';

const MARKUP = html`
	<div id="ocr_results" class="container is-fluid columns is-desktop">
		<fieldset class="column">
			<legend>Frame Data</legend>
			<dl id="frame_data"></dl>
		</fieldset>
		<fieldset class="column">
			<legend>OCR Performance (in ms)</legend>
			<dl id="perf_data"></dl>
		</fieldset>
	</div>
`;

export class NTC_Producer_ConfigArea extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {
			frame_data: this.shadow.getElementById('frame_data'),
			perf_data: this.shadow.getElementById('perf_data'),
		};
	}

	setPerfData() {}

	setFrameData() {}
}

customElements.define('ntc-configarea', NTC_Producer_ConfigArea);
