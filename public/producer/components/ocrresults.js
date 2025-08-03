import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';

const MARKUP = html` <h1 class="title">OCR Results</h1> `;

export class NTC_Producer_OcrResults extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this.shadow.innerHTML = MARKUP;

		this.#domrefs = {};
	}
}

customElements.define('ntc-ocrresults', NTC_Producer_OcrResults);
