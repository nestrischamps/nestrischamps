import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import { getPalette } from '/ocr/palettes.js';

const OLD_CONFIG_NAME = 'config_v2';

function getConfigName() {
	return QueryString.get('config') || 'config_v2b';
}

export function hasConfig() {
	let maybeConfig = localStorage.getItem(getConfigName());

	if (!maybeConfig) {
		// delete old config, just in case
		localStorage.removeItem(OLD_CONFIG_NAME);
		return false;
	}

	// minimal checks for validity of the config object
	// could add comprehensive verification later
	// for now guard against initial calibration not completed
	try {
		const parsed = JSON.parse(maybeConfig);

		if (parsed?.device_id === 'everdrive') return true;

		// TODO validate config
		if (parsed.mode === 'multiviewer') return true;

		// For OCR capture, we check that the task list is valid
		// TODO: validate properly
		if (!parsed?.tasks) return false;

		const tasks = Object.values(parsed.tasks);
		if (tasks.length <= 0) return false;
		if (!tasks.every(task => !!task.crop)) return false;
	} catch (err) {
		return false;
	}

	return true;
}

export function getGameTypeFromTasks(tasks) {
	return tasks.T
		? BinaryFrame.GAME_TYPE.CLASSICcapture
		: tasks.cur_piece_das
			? BinaryFrame.GAME_TYPE.DAS_TRAINER
			: BinaryFrame.GAME_TYPE.MINIMAL;
}

export async function loadConfig() {
	const config = localStorage.getItem(getConfigName());

	if (config) {
		const parsed = JSON.parse(config); // TODO try..catch

		if (parsed.mode === 'multiviewer') {
			parsed.save = function () {
				saveMultiviewerConfig(this);
			};

			for (const playerConf of parsed.players) {
				if (!playerConf.hasOwnProperty('game_type')) {
					playerConf.game_type = getGameTypeFromTasks(playerConf.tasks);
				}

				Object.entries(playerConf.tasks).forEach(
					([name, task]) => (task.name = name)
				);

				if (playerConf.palette) {
					playerConf.palette_data = await getPalette(playerConf.palette); // TODO report error
				}

				playerConf.save = function () {
					parsed.save();
				};
			}
		} else {
			if (!parsed.hasOwnProperty('game_type')) {
				parsed.game_type = getGameTypeFromTasks(parsed.tasks);
			}

			Object.entries(parsed.tasks).forEach(
				([name, task]) => (task.name = name)
			);

			parsed.save = function () {
				saveConfig(this);
			};

			if (parsed.palette) {
				parsed.palette_data = await getPalette(parsed.palette); // TODO report error
			}
		}

		return parsed;
	}
}

export function getSerializableConfigCopy(config) {
	const {
		device_id,
		game_type,
		palette,
		cap_frame_rate,
		cap_width,
		cap_height,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_worker_for_interval,
		handle_retron_levels_6_7,
	} = config;

	// need to drop non-serializable fields
	const config_copy = {
		device_id,
		game_type,
		palette,
		cap_frame_rate,
		cap_width,
		cap_height,
		allow_video_feed,
		video_feed_device_id,
		brightness,
		contrast,
		score7,
		use_worker_for_interval,
		handle_retron_levels_6_7,
		tasks: {},
	};

	for (const [name, task] of Object.entries(config.tasks)) {
		const { crop, pattern, luma, red_luma } = task;
		config_copy.tasks[name] = { crop, pattern, luma, red_luma };
	}

	return config_copy;
}

export function saveConfig(config) {
	const config_copy = getSerializableConfigCopy(config);
	localStorage.setItem(getConfigName(), JSON.stringify(config_copy));
}

export function saveMultiviewerConfig(config) {
	const config_copy = { ...config };

	config_copy.players = config_copy.players.map(config =>
		getSerializableConfigCopy(config)
	);

	localStorage.setItem(getConfigName(), JSON.stringify(config_copy));
}

export function clearConfigAndReset() {
	if (
		confirm(
			'You are about to remove your current configuration. You will have to recalibrate. Are you sure?'
		)
	) {
		localStorage.removeItem(getConfigName());
		location.reload();
	}
}

export function getDefaultOcrConfig() {
	return {
		game_type: 1,
		palette: '',
		allow_video_feed: false,
		video_feed_device_id: null,
		brightness: 1,
		contrast: 1,
		score7: false,
		use_worker_for_interval: true,
		handle_retron_levels_6_7: false,
		tasks: {},
		save: function () {
			saveConfig(this);
		},
	};
}
