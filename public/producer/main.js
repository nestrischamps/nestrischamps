import './components/wizard.js';
import './components/capture.js';

import QueryString from '/js/QueryString.js';
import { sleep, timer } from './timer.js';
import { hasConfig, loadConfig } from './ConfigUtils.js';
import { getStream } from '../MediaUtils.js';
import { Connection } from 'pg';

function loadCaptureUI() {
	const element = document.createElement('ntc-capture');
	element.id = 'capture';
	document.body.prepend(element);
}

let pipeline;

(async function main() {
	// unfortunate bootstrap delay, but makes everything else simpler later on
	await timer.init();

	// load external assets - could parrallelize
	// templates = await loadDigitTemplates();
	// palettes = await loadPalettes();

	// showTemplates(templates);
	// await updatePaletteList();

	if (hasConfig()) {
		const config = loadConfig();

		if (config.device_id === 'everdrive') {
		} else {
			// transformation of color numbers for old configs
			// TODO: delete when everyone is using the new config
			if (config.tasks.color1 && !config.tasks.color3) {
				config.tasks.color3 = config.tasks.color2;
				config.tasks.color2 = config.tasks.color1;

				delete config.tasks.color1;
			}

			const stream = getStream(config);
			const ocr = new cpuTetrisORC(stream, config);
			const gameTracker = new GameTracker();
			const connection = new Connection();

			ocr.onFrame = (ocrdata, perfdata) => {
				// ocrdata contains ONLY OCR data
				// e.g. the board is 200 color values
				// preview is a collection of shine points at known coordinates

				gameTracker.setFrame(data);
			};

			if (showFrame) {
				ocr.onFrame = () => {
					// add one step of processing and display
					ocr.updateCanvas();
				};
			}

			gameTracker.onframe = data => {
				// dedup duplicate frames
				connection.send(data);
			};
		}

		await resetDevices();

		capture_rate.value = config.frame_rate || default_frame_rate;

		let tmp_use_half_height = QueryString.get('disable_half_height') !== '1';

		if ('use_half_height' in config) {
			tmp_use_half_height = !!config.use_half_height;
		}

		score7.checked = config.score7 === true;
		use_half_height.checked = tmp_use_half_height;
		allow_video_feed.checked = config.allow_video_feed != false;
		focus_alarm.checked = config.focus_alarm != false;
		use_worker_for_interval.checked = config.use_worker_for_interval != false;
		handle_retron_levels_6_7.checked = config.handle_retron_levels_6_7 != false;

		const brightness = config.brightness === undefined ? 1 : config.brightness;
		brightness_slider.value = config.brightness = brightness;
		brightness_value.textContent = brightness.toFixed(2);

		const contrast = config.contrast === undefined ? 1 : config.contrast;
		contrast_slider.value = config.contrast = contrast;
		contrast_value.textContent = contrast.toFixed(2);

		updateImageCorrection();

		if (config.device_id === 'everdrive') {
			removeCalibrationTab();
			initCaptureFromEverdrive(config.frame_rate);
		} else {
			if (config.device_id === 'window') {
				config.use_half_height = false;
				use_half_height.checked = false;
				use_half_height.parentNode.remove();
			}

			await playVideoFromConfig();
			trackAndSendFrames();
		}

		tabs[1].click(); // data tab
		showProducerUI();
	} else {
		const wizard = document.createElement('ntc-wizard');
		document.body.prepend(wizard);

		wizard.addEventListener('config-ready', async evt => {
			console.log(`Received config-ready`, { config: evt.detail.config });

			await sleep(0);

			wizard.remove();

			loadCaptureUI();
		});

		/*
		capture_rate.value = default_frame_rate;

		// create default dummy waiting to be populated by user selection
		config = {
			frame_rate: default_frame_rate,
			tasks: {},
		};

		video.classList.add('is-hidden');
		wizard.append(video);
		wizard.classList.remove('is-hidden');

		// TODO: await completion of the calibration before connecting
        /**/
	}

	// we connect last so UI is ready before we try to send any data or video feed
	// connect();
})();
