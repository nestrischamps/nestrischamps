import got from 'got';
import zlib from 'zlib';
import fs from 'fs';

import BinaryFrame from '../public/js/BinaryFrame.js';
import ScoreDAO from '../daos/ScoreDAO.js';
import config from '../modules/config.js';

class Replay {
	constructor(connection, player_num, game_id_or_url, time_scale = 1) {
		this.connection = connection;
		this.player_num = player_num;
		this.game_id_or_url = game_id_or_url;
		this.time_scale = time_scale;
		this.frame_buffer = [];
		this.frame_size = 0;

		this.startStreaming();
	}

	async startStreaming() {
		if (typeof this.game_id_or_url === 'string') {
			if (this.game_id_or_url.startsWith('http')) {
				const game_url = this.game_id_or_url;
				this.game_stream = got.stream(game_url);
			} else {
				console.log(`Replay Error: Invalid Game URL: this.game_id_or_url`);
				return;
			}
		} else {
			const game_id = this.game_id_or_url;
			const score_data = await ScoreDAO.getAnonymousScore(game_id);

			if (!score_data) {
				console.log(`Replay Error: No game found for gameid ${game_id}.`);
				return;
			}

			const file_path = score_data.frame_file;

			if (!file_path) {
				console.log(
					`Replay Error: No replay file found for gameid ${game_id}:`,
					score_data
				);
				return;
			}

			// For attribution!
			this.connection.send([
				'setLogin',
				this.player_num,
				score_data.login || `Player ${this.player_num + 1}`,
			]);
			this.connection.send([
				'setDisplayName',
				this.player_num,
				score_data.display_name || `Player ${this.player_num + 1}`,
			]);
			this.connection.send([
				'setProfileImageURL',
				this.player_num,
				score_data.profile_image_url,
			]);
			this.connection.send([
				'setCountryCode',
				this.player_num,
				score_data.country_code,
			]);

			if (config.get('game.frames_bucket')) {
				// data comes from S3
				//https://nestrischamps.s3-us-west-1.amazonaws.com/
				const base_url = `https://${config.get('game.frames_bucket')}.s3-${config.get('game.frames_region')}.amazonaws.com/`;

				this.game_stream = got.stream(`${base_url}${file_path}`);
			} else {
				// data comes from local file
				this.game_stream = fs
					.createReadStream(file_path)
					.pipe(zlib.createGunzip());
			}
		}

		this.game_stream.on('readable', () => {
			/* eslint-disable no-constant-condition */
			do {
				if (!this.frame_size) {
					const buf = this.game_stream.read(1);

					if (buf === null) {
						console.warn(`warning: getting null buffer when reading one byte`);
						// shouldn't happen but 🤷
						// is this a memory leak? 🤔
						return;
					}

					if (!buf.length) {
						break;
					}

					const b = new Uint8Array(buf);
					const version = b[0] >> 5 || 1;

					if (BinaryFrame.FRAME_SIZE_BY_VERSION[version]) {
						this.frame_size = BinaryFrame.FRAME_SIZE_BY_VERSION[version];
						this.game_stream.unshift(buf);
						console.info(
							`Found version ${version} with size ${this.frame_size}`
						);
						continue;
					} else {
						// unknown version, do nothing
						// is this a memory leak? 🤔
						console.warn(
							`warning: unknown version in replay file ${this.game_id_or_url}: ${version}`
						);
						return;
					}
				}

				const buf = this.game_stream.read(this.frame_size);

				if (buf === null) {
					return; // done!!
				}

				if (buf.length < this.frame_size) {
					this.game_stream.unshift(buf);
					break;
				}

				if (!this.start_time) {
					// Parsing the frame may not be needed just to get ctime
					// but we should also check the version format

					const data = BinaryFrame.parse(buf);

					this.start_time = Date.now();
					this.start_ctime = data.ctime;
				}

				this.frame_buffer.push(buf);

				this.sendNextFrame();
			} while (true);

			this.game_stream.read(0);
		});

		// TODO: Error handling close handling on source and target, etc...
	}

	sendNextFrame() {
		if (this.send_timeout) return;
		if (this.frame_buffer.length <= 0) return;

		const frame = new Uint8Array(this.frame_buffer.shift());

		frame[0] = (frame[0] & 0b11111000) | this.player_num;

		const tdiff = Math.round(
			(BinaryFrame.getCTime(frame) - this.start_ctime) / this.time_scale
		);
		const frame_tick = this.start_time + tdiff;
		const now = Date.now();

		const send_delay = Math.max(0, frame_tick - now);

		this.send_timeout = setTimeout(() => {
			this.send_timeout = null;
			this.connection.send(frame);
			this.sendNextFrame();
		}, send_delay);
	}
}

export default Replay;
