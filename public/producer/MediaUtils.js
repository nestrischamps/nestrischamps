import QueryString from '/js/QueryString.js';

export const CAP_TYPE = (value =>
	/^(pal|ntsc)$/.test(value) ? value : 'ntsc')(QueryString.get('captype'));

export async function getConnectedDevices(type) {
	let stream;

	try {
		// prompt for permission if needed
		// on windows, this requests the first available capture device and it may fail
		// BUT if permission has been granted, then listing the devices below might still work
		// So, we wrap the device call in a try..catch, and ignore errors
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

	if (stream) {
		stream.getTracks().forEach(track => track.stop());
	}

	return devices;
}

export async function getDeviceLabel(device_id) {
	if (!device_id) return '';
	const devices = await getConnectedDevices('videoinput');
	const device = devices.find(d => d.deviceId === device_id);
	return device ? device.label : 'Unknown Device';
}

export function getStreamSettings(stream) {
	const track = stream.getVideoTracks()[0];
	return track.getSettings();
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

	const ideal_frame_rate = config.cap_frame_rate || 60;

	let stream;

	try {
		if (config.device_id === 'window') {
			const constraints = {
				audio: false,
				video: {
					cursor: 'never',
					frameRate: { ideal: ideal_frame_rate },
				},
			};

			stream = await navigator.mediaDevices.getDisplayMedia(constraints);
			stream.ntcType = 'screencap';
		} else {
			// for consistency sake, the config is assumed to have the details of capture height and framerate
			const constraints = {
				audio: false,
				video: {
					deviceId: { exact: config.device_id },
					width: {
						ideal: config.cap_width,
					},
					height: {
						ideal: config.cap_height,
					},
					frameRate: { ideal: ideal_frame_rate }, // Should we always try to get the highest the card can support?
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
		if (err.name === 'AbortError') {
			if (ideal_frame_rate === 60 || ideal_frame_rate === 50) {
				const recovery_frame_rate = ideal_frame_rate === 60 ? 30 : 25;

				console.warn(
					`Unable to get stream: ${err.name}: ${err.message}. Was requesting ${ideal_frame_rate}fps. Attempting recovery with ${recovery_frame_rate}fps`
				);

				config.frame_rate = recovery_frame_rate;
				return getStream(config);
			}
		}

		console.error(`Unable to get stream: ${err.name}: ${err.message}`);
		throw err;
	}
}

export async function playVideoFromDevice(video, options = {}) {
	console.log('playVideoFromDevice()');

	const { mode, grid, device_id } = options;

	try {
		const initConstraints = {
			audio: false,
			video: {
				frameRate: { ideal: mode === 'multiviewer' ? 30 : 60 },
				height: { ideal: mode === 'multiviewer' ? 1080 : 720 },
			},
		};

		if (device_id) {
			initConstraints.video.deviceId = { exact: device_id };
		}

		console.log(
			`Initial Constraints: ${JSON.stringify(initConstraints, null, 2)}`
		);

		const stream = await navigator.mediaDevices.getUserMedia(initConstraints);

		// we only prompt for permission with the first call
		if (!device_id) return;

		// now that we have the stream, we apply additional constraint to find the best operation match
		let videoConstraints;

		const fullFps = CAP_TYPE === 'pal' ? 50 : 60;
		const halfFps = CAP_TYPE === 'pal' ? 25 : 30;

		if (mode === 'multiviewer') {
			const resizeMode = 'none';

			videoConstraints = {
				height: { min: 720, ideal: 1080 },
				frameRate: { ideal: halfFps },
				advanced: [
					// { height: 1080, frameRate: 60 }, // works on OSX, freezes on windows ??
					...(grid === '4x2'
						? [
								{ width: 3840, height: 1080, frameRate: halfFps, resizeMode }, // 960x540 x4 x2 (dual 1920x1080 4xmultiviewers side by side)
								{ width: 2880, height: 972, frameRate: halfFps, resizeMode }, // 720x486 x4 x2
								{ width: 2560, height: 960, frameRate: halfFps, resizeMode }, // 640x480 x4 x2
							]
						: []),
					...(grid === '3x2'
						? [
								{ width: 2160, height: 972, frameRate: halfFps, resizeMode }, // 720x486 x3 x2
								{ width: 1920, height: 960, frameRate: halfFps, resizeMode }, // 640x480 x3 x2
							]
						: []),
					{ width: 1920, height: 1080, frameRate: halfFps, resizeMode }, // assumes standards 4xMultiviewer device
					{ height: 1080, frameRate: halfFps },
					{ height: 960, frameRate: halfFps },
					{ width: 1280, height: 720, frameRate: fullFps },
					{ width: 1280, height: 720, frameRate: halfFps },
					{ height: 720, frameRate: fullFps },
					{ height: 720, frameRate: halfFps },
					{ height: 1080 }, // try for size - any fps
					{ height: 960 }, // try for size - any fps
				],
			};
		} else {
			videoConstraints = {
				height: { min: 240, ideal: 720 },
				frameRate: { ideal: fullFps },
				advanced: [
					{ height: 720, frameRate: fullFps },
					{ width: 1280, height: 720, frameRate: halfFps },
					{ height: 720, frameRate: halfFps },
					{ height: 480, frameRate: fullFps },
					{ height: 480, frameRate: halfFps },
					{ frameRate: halfFps },
					{ height: 480 },
				],
			};
		}

		const track = stream.getVideoTracks()[0];

		let remainingAttempts = 1;

		while (true) {
			console.log('Attempting to apply video constraints', videoConstraints);
			try {
				await track.applyConstraints(videoConstraints);
				console.log('Successfully applied video constraints');
			} catch (err) {
				// try one more time while dropping the most aggressive constraint
				if (remainingAttempts-- > 0) {
					console.warn(
						'Unable to apply video constraints - retrying with looser constraints',
						err
					);
					videoConstraints.advanced.shift();
					continue;
				}

				console.warn('Unable to apply video constraints');
			}

			break;
		}

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
				cursor: 'never', // https://www.w3.org/TR/screen-capture/#dom-cursorcaptureconstraint
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

function checkImageTypeSupport(type) {
	return new Promise(resolve => {
		const c = document.createElement('canvas');
		c.width = c.height = 1;
		c.toBlob(
			blob => {
				if (blob?.type !== type) return resolve(false);

				// Try to decode it back
				const img = new Image();
				img.onload = () => resolve(true);
				img.onerror = () => resolve(false);
				img.src = URL.createObjectURL(blob);
			},
			type,
			0.5
		);
	});
}

async function _getSupportedImageTypes() {
	const [webp, jpeg, png] = await Promise.all([
		checkImageTypeSupport('image/webp'),
		checkImageTypeSupport('image/jpeg'),
		checkImageTypeSupport('image/png'),
	]);

	return {
		'image/webp': webp,
		'image/jpeg': jpeg,
		'image/png': png,
	};
}

const supportedImageTypesPromise = _getSupportedImageTypes();

export async function supportsImageType(type) {
	return !!(await supportedImageTypesPromise)[type];
}
