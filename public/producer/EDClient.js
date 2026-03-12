// Request and report Data as-is
// Handle errors and reconnections

const EVERDRIVE_N8_PRO = { usbVendorId: 0x483, usbProductId: 0x5740 };
const EVERDRIVE_CMD_GET_STATUS = 0x10;
const EVERDRIVE_CMD_MEM_WR = 0x1a;
const EVERDRIVE_CMD_SEND_STATS = 0x42;
const EVERDRIVE_ADDR_FIFO = 0x1810000;
const GAME_FRAME_SIZE = 237;
const EVERDRIVE_TAIL = [0x00, 0xa5];
const GAME_FRAME_TAIL = [0xaa, 0xaa];
const ED_MAX_READ_ATTEMPTS = 10;

export async function getEDSerialPort() {
	let serialPort;

	const ports = await navigator.serial.getPorts();

	if (ports.length) {
		serialPort = ports.find(port => {
			const { usbProductId, usbVendorId } = port.getInfo();
			return (
				usbVendorId === EVERDRIVE_N8_PRO.usbVendorId &&
				usbProductId === EVERDRIVE_N8_PRO.usbProductId
			);
		});

		if (serialPort) return serialPort;
	}

	serialPort = await navigator.serial.requestPort({
		filters: [EVERDRIVE_N8_PRO],
	});

	if (serialPort) return serialPort;
}

function getEDCommandHeader(command) {
	// prettier-ignore
	return [
        '+'.charCodeAt(0),
        '+'.charCodeAt(0) ^ 0xff,
        command,
        command ^ 0xff
    ];
}

async function readInto(reader, dataArray) {
	let buffer = dataArray.buffer;
	let offset = 0;

	while (offset < buffer.byteLength) {
		// TODO: how to implement read timeout?
		const { value, done } = await reader.read(new Uint8Array(buffer, offset));
		if (done) {
			break;
		}
		buffer = value.buffer;
		offset += value.byteLength;
	}
	return new Uint8Array(buffer);
}

async function readUntilPattern(reader, dataArray, compare) {
	dataArray = await readInto(reader, dataArray);

	if (
		compare.every(
			(e, i) => e === dataArray[dataArray.length - compare.length + i]
		)
	) {
		return dataArray;
	}

	// flush the buffer, return an empty result
	while (true) {
		try {
			let { value, done } = await Promise.race([
				reader.read(new Uint8Array(GAME_FRAME_SIZE * 2)),
				new Promise((_, reject) =>
					setTimeout(reject, 150, new Error('timeout'))
				),
			]);

			if (done) {
				console.log('Flushed value', value);
				break;
			}
		} catch (e) {
			console.error('Flushed Buffer');
		}
	}
}

export default class EDClient extends EventTarget {
	#captureDetails = null;
	#previousFrameTime;
	#previousFrameCounter = null;

	constructor(frameRate) {
		super();

		this.frameDuration = 1000 / frameRate;
		this.requestFrameFromEverDrive = this.requestFrameFromEverDrive.bind(this);

		this.#captureDetails = {
			mode: 'everdrive',
			frameRate: frameRate,
			frameMs: this.frameDuration,
		};

		this.init();
	}

	async init() {
		this.everdrive = await this.getEverDrive();

		if (this.everdrive) {
			this.dataFrameBuffer = new Uint8Array(GAME_FRAME_SIZE);
			this.startTime = performance.now();
			this.requestFrameFromEverDrive();
		} else {
			// What to do?
		}
	}

	async getEverDrive() {
		const port = await getEDSerialPort();

		if (!port) {
			console.error('No ever drive not found');
			return;
		}

		try {
			await port.open({ baudRate: 115200, bufferSize: GAME_FRAME_SIZE }); // plenty of speed for 60fps data frame from gym are 240 bytes: 240x60=14400
		} catch (err) {
			console.warn(err);
			// assume port is already open for now
			// TODO: better error checking
		}

		const reader = port.readable.getReader({ mode: 'byob' });
		const writer = port.writable.getWriter();

		if (await this.verifyEDPort(reader, writer)) {
			return {
				port,
				reader,
				writer,
			};
		}
	}

	async verifyEDPort(reader, writer) {
		// verify we have a real everdrive by sending a GET_STATUS command
		// (expecting [0x00, 0xA5] as response)
		const bytes = getEDCommandHeader(EVERDRIVE_CMD_GET_STATUS);

		let success = false;
		for (let attempt = ED_MAX_READ_ATTEMPTS; attempt--; ) {
			await writer.write(new Uint8Array(bytes));
			try {
				await readUntilPattern(reader, new Uint8Array(2), EVERDRIVE_TAIL);
				success = true;
				break;
			} catch (e) {
				console.error(`!Failed to read everdrive: ${e}`);
			}
		}

		if (!success) {
			console.error(`Max attempts ${ED_MAX_READ_ATTEMPTS} reached`);
			return false;
		}

		// restore the buffer for next use
		// data_frame_buffer = new Uint8Array(value.buffer);

		console.log('Everdrive verified!');
		return true;
	}

	async requestFrameFromEverDrive() {
		performance.clearMarks();
		performance.clearMeasures();

		performance.mark('edlink_comm_start');

		// 0. prep request
		// ref: https://github.com/zohassadar/EDN8-PRO/blob/nestrischamps/edlink-n8/edlink-n8/Edio.cs#L622
		const bytes = [
			...getEDCommandHeader(EVERDRIVE_CMD_MEM_WR),

			// addr
			EVERDRIVE_ADDR_FIFO & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 8) & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 16) & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 24) & 0xff,

			// len
			1,
			0,
			0,
			0,

			// exec
			0,

			EVERDRIVE_CMD_SEND_STATS,
		];

		// 1. send request
		const res = await this.everdrive.writer.write(new Uint8Array(bytes));

		performance.mark('edlink_write_end');

		// 2. read response
		try {
			// TODO: how to implement read timeout?
			this.dataFrameBuffer = await readUntilPattern(
				this.everdrive.reader,
				this.dataFrameBuffer,
				GAME_FRAME_TAIL
			);
		} catch (e) {
			console.error(`Error reading from everdrive: ${e}`);
		}

		const frameTime = performance.now();

		performance.mark('edlink_read_end');

		performance.measure(
			'edlink_write_cmd',
			'edlink_comm_start',
			'edlink_write_end'
		);
		performance.measure(
			'edlink_read_data',
			'edlink_write_end',
			'edlink_read_end'
		);
		performance.measure('edlink_total', 'edlink_comm_start', 'edlink_read_end');

		// inspect data to evaluate if there are skipped frames
		// kinda dirty because now the edclient knows the data format :(

		const frameCounter0 = this.dataFrameBuffer[18];

		let skipped = 0;
		if (this.#previousFrameCounter !== null) {
			skipped = frameCounter0 - this.#previousFrameCounter - 1;
		}

		this.dispatchEvent(
			new CustomEvent('frame', {
				detail: {
					ts: frameTime,
					skipped,
					elapsed: frameTime - (this.#previousFrameTime || this.startTime || 0),
					captureDetails: this.#captureDetails,
					data: this.dataFrameBuffer,
				},
			})
		);

		this.#previousFrameCounter = frameCounter0;
		this.#previousFrameTime = frameTime;

		// We trigger the next read immediately, the read will wait till the data is ready
		setTimeout(this.requestFrameFromEverDrive, 0);
	}
}
