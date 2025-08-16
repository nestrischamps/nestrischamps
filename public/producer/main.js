import './components/wizard.js';
import './components/capture.js';

import QueryString from '/js/QueryString.js';
import { sleep, timer } from './timer.js';
import { hasConfig, loadConfig } from './ConfigUtils.js';
import { getStream } from './MediaUtils.js';
import { CpuTetrisOCR } from './cpuTetrisOCR.js';

function loadCaptureUI() {
	const capture = document.createElement('ntc-capture');

	capture.id = 'capture';
	document.body.prepend(capture);

	return capture;
}

async function initFromConfig(tabToOpen) {
	const config = loadConfig();

	if (config.device_id === 'everdrive') {
		removeCalibrationTab();
		initCaptureFromEverdrive(config.frame_rate);
	} else {
		// transformation of color numbers for old configs
		// TODO: delete when everyone is using the new config
		if (config.tasks.color1 && !config.tasks.color3) {
			config.tasks.color3 = config.tasks.color2;
			config.tasks.color2 = config.tasks.color1;

			delete config.tasks.color1;
		}

		const stream = await getStream(config);
		const ocr = new CpuTetrisOCR(stream, config);

		const capture = loadCaptureUI();
		capture.setOCR(ocr);
		capture.showTab(tabToOpen);

		// const gameTracker = new GameTracker();
		// const connection = new Connection();

		// ocr.onFrame = (ocrdata, perfdata) => {
		// 	// ocrdata contains ONLY OCR data
		// 	// e.g. the board is 200 color values
		// 	// preview is a collection of shine points at known coordinates

		// 	gameTracker.setFrame(data);
		// };

		// if (showFrame) {
		// 	ocr.onFrame = () => {
		// 		// add one step of processing and display
		// 		ocr.updateCanvas();
		// 	};
		// }

		// gameTracker.onframe = data => {
		// 	// dedup duplicate frames
		// 	connection.send(data);
		// };
	}
}

(async function main() {
	console.log('main');
	// unfortunate bootstrap delay, but makes everything else simpler later on
	await timer.init();

	// load external assets - could parrallelize
	// templates = await loadDigitTemplates();
	// palettes = await loadPalettes();

	// showTemplates(templates);
	// await updatePaletteList();

	if (hasConfig()) {
		console.log('has config');
		initFromConfig('ocr_results');
	} else {
		const wizard = document.createElement('ntc-wizard');
		document.body.prepend(wizard);

		wizard.addEventListener(
			'config-ready',
			async evt => {
				console.log(`Received config-ready`, { config: evt.detail.config });

				await sleep(0);
				wizard.remove();
				await sleep(0);
				initFromConfig('calibration');

				setTimeout(() => {
					alert(
						'Rough calibration has been completed 🎉!\n\nYou now MUST inspect and fine tune all the fields (location and size) to make them pixel perfect!'
					);
				}, 100); // sad (and gross) delay
			},
			{ once: true }
		);
	}

	// we connect last so UI is ready before we try to send any data or video feed
	// connect();
})();
