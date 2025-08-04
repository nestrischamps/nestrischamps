export class NtcComponent extends HTMLElement {
	constructor() {
		super();

		this.shadow = this.attachShadow({ mode: 'open' });

		// NTC components will inherit bulma styles
		window.BULMA_STYLESHEETS.then(sheets => {
			this.shadow.adoptedStyleSheets = [...sheets];
		});
	}
}
