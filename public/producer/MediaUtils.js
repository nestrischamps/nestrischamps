import QueryString from '/js/QueryString.js';

export const DEFAULT_1P_CAPTURE_HEIGHT = (value =>
	/^[1-9]\d+$/.test(value) ? parseInt(value, 10) : 720)(
	QueryString.get('capheight')
);

export async function getConnectedDevices(type) {
	let stream;

	try {
		// prompt for permission if needed
		// on windows, this requests the first available capture device and it may fail
		// BUT if permission has been granted, then listing the devices below might still work
		// SO, we wrap the device call in a try..catch, and ignore errors
		stream = await navigator.mediaDevices.getUserMedia({ video: true });
	} catch (err) {
		// We log a warning but we do nothing
		console.log(
			`Warning: could not open default capture device: ${err.message}`
		);
	}

	const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
		device => device.kind === type && device.deviceId
	);

	if (stream) stream.getTracks()[0].stop();

	return devices;
}

export function logStreamDetails(stream) {
	const track = stream.getVideoTracks()[0];
	const settings = track.getSettings();
	const capabilities = track.getCapabilities?.() || null;

	console.log(`Stream Details: ${JSON.stringify(settings, null, 2)}`);
	console.log(`Stream Capabilities: ${JSON.stringify(capabilities, null, 2)}`);
}

export async function getStream(config) {
	if (config.device_id === 'everdrive' || !config.device_id) {
		throw new Exception(`getSream(): Unexpected device id`);
	}

	const default_frame_rate = 60;

	let stream;

	try {
		if (config.device_id === 'window') {
			const constraints = {
				audio: false,
				video: {
					cursor: 'never',
					frameRate: { ideal: fps },
				},
			};

			stream = await navigator.mediaDevices.getDisplayMedia(constraints);
			stream.ntcType = 'screencap';
		} else {
			const constraints = {
				audio: false,
				video: {
					deviceId: { exact: config.device_id },
					height: {
						ideal:
							config.mode === 'multiviewer' ? 1080 : DEFAULT_1P_CAPTURE_HEIGHT,
					},
					frameRate: { ideal: config.frame_rate || default_frame_rate }, // Should we always try to get the highest the card can support?
				},
			};

			console.log(
				`Capture Constraints: ${JSON.stringify(constraints, null, 2)}`
			);

			stream = await navigator.mediaDevices.getUserMedia(constraints);
			stream.ntcType = 'device';
		}

		logStreamDetails(stream);
		return stream;
	} catch (err) {
		console.error(`Unable to get stream: ${err.message}`);
		throw err;
	}
}

export async function playVideoFromDevice(video, options = {}) {
	console.log('playVideoFromDevice()');
	const ideal = {
		device_id: options.device_id || undefined,
		fps: options.fps || 60,
		height: options.height || DEFAULT_1P_CAPTURE_HEIGHT,
	};

	try {
		const constraints = {
			audio: false,
			video: {
				height: { ideal: ideal.height },
				frameRate: { ideal: ideal.fps }, // Should we try to get the highest the card can support?
				// brightness: { ideal: ideal.brightness || 0 },
				// contrast: { ideal: ideal.contrast || 140 },
				// saturation: { ideal: ideal.saturation || 140 },
			},
		};

		if (ideal.device_id) {
			constraints.video.deviceId = { exact: ideal.device_id };
		}

		console.log(`Capture Constraints: ${JSON.stringify(constraints, null, 2)}`);

		const stream = await navigator.mediaDevices.getUserMedia(constraints);

		// we only prompt for permission with the first call
		if (ideal.device_id === undefined) return;

		logStreamDetails(stream);

		// when an actual device id is supplied, we start everything
		video.srcObject = stream;
		video.ntcType = 'device';
		video.play();
	} catch (error) {
		console.error('Error opening video camera.', error);
		video.pause();
	}
}

export async function playVideoFromScreenCap(video, fps = 60) {
	console.log('playVideoFromScreenCap()');

	try {
		const constraints = {
			audio: false,
			video: {
				cursor: 'never',
				frameRate: { ideal: fps },
			},
		};

		const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

		// when an actual device id is supplied, we start everything
		video.srcObject = stream;
		video.ntcType = 'screencap';
		video.play();
	} catch (error) {
		console.error('Error capturing window.', error);
		video.pause();
	}
}

export async function playVideoFromConfig(video, frame_rate = 60) {
	if (!config.device_id) {
		return;
	}

	video.classList.remove('is-hidden');

	if (config.device_id === 'window') {
		await playVideoFromScreenCap(config.frame_rate);
	} else {
		await playVideoFromDevice(config.device_id, config.frame_rate);
	}

	capture_rate
		.querySelectorAll('.device_only')
		.forEach(elmt => (elmt.hidden = config.device_id === 'window'));
}
