// Minimum amount of game tracking to do server side to be able to report games
import BinaryFrame from '../public/js/BinaryFrame.js';
import ScoreDAO from '../daos/ScoreDAO.js';
import { ulid } from 'ulid';

// The below is to upload game frames to S3
// That should be refactored into another file
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import zlib from 'zlib';

import fs from 'fs';
import path from 'path';

const PIECES = ['T', 'J', 'Z', 'O', 'S', 'L', 'I'];
const SCORE_BASES = [0, 40, 100, 300, 1200];
const LINE_CLEAR_IGNORE_FRAMES = 7;

class Game {
	constructor(user, { competition = false }) {
		this.frame_file = '';
		this.user = user;
		this.competition = !!competition;
		this.frame_count = 0;
		this.data = null;
		this.over = false;
		this.num_frames = 0;

		this.save_frame = process.env.FF_SAVE_GAME_FRAMES === '1';

		if (this.save_frame) {
			// We use ulid ids for games, and games get binned into part of the 10 bits timestamp
			// this means each folder represents about ~9h, which should be about one siting
			// the extension ngf stands for "Nestrischamps Game Frames"
			const gameid = ulid();
			const dir = `games/${user.id}/${gameid.slice(0, 5)}`;
			const file = `${gameid.slice(5)}.ngf`;

			this.frame_file = `${dir}/${file}`;

			// Set up a streaming upload system to S3
			this.frame_stream = zlib.createGzip();

			if (process.env.GAME_FRAMES_BUCKET) {
				const upload = new Upload({
					client: new S3Client({ region: process.env.GAME_FRAMES_REGION }),
					leavePartsOnError: false,
					params: {
						Bucket: process.env.GAME_FRAMES_BUCKET,
						Key: this.frame_file,
						Body: this.frame_stream,
						ACL: 'public-read',
						ContentType: 'application/nestrischamps-game-frames',
						ContentEncoding: 'gzip',
						ContentDisposition: 'attachment',
						CacheControl: 'max-age=315360000',
					},
				});

				// set up some logging for game file upload
				upload.done().then(
					() => console.log(`Game file uploaded: ${this.frame_file}`),
					err =>
						console.log(
							`Unable to upload game file ${this.frame_file}: ${err.message}`
						)
				);
			} else if (process.env.IS_PUBLIC_SERVER !== '1') {
				// Saving on local filesystem

				fs.mkdirSync(dir, { recursive: true }); // sync action is no good! Can we do without the sync? 😰
				this.frame_stream.pipe(fs.createWriteStream(path.join(dir, file)));
			}
		}
	}

	end() {
		if (!this.over) {
			this._doGameOver();
		}
	}

	setFrame(frame) {
		const data = BinaryFrame.parse(frame);

		if (data.score === null || data.lines === null || data.level === null) {
			// not in game
			return;
		}

		this.frame_count++;

		if (!this.data) {
			// Game initialization frame
			// Assume good timing and record initial state from it as-is

			this.IS_CLASSIC_ROM = data.game_type === BinaryFrame.GAME_TYPE.CLASSIC;

			this.gameid = data.gameid;
			this.start_ts = Date.now();
			this.start_level = data.level;

			this.num_blocks = this._getNumBlocks(data); // assume correct...
			this.num_pieces = 0;
			this.prior_preview = 'O';

			this.tetris_lines = 0;

			this.cur_drought = 0;
			this.max_drought = 0;
			this.num_droughts = 0;

			this.das_total = 0;

			this.transition = null;
			this.pieces = [];
			this.clears = [];

			this.pending_score = false;
			this.pending_piece = true;

			this.clear_animation_remaining_frames = 0;

			this.data = data; // record frame as current state

			this.saveFrame(frame);

			return;
		}

		if (data.gameid != this.gameid) {
			this.end();
			this.onNewGame(frame);
			return;
		}

		if (this.over) {
			return;
		}

		this.saveFrame(frame);

		const cur_num_blocks = this._getNumBlocks(data);

		if (this.pending_score) {
			this.pending_score = false;
			this.onScore(data); // updates state
		} else {
			if (data.score === 999999) {
				this.pending_score = data.lines != this.data.lines;
			} else {
				const high_score = this.data.score / 1600000;

				if (high_score >= 1) {
					this.pending_score = data.score != this.data.score % 1600000;
				} else {
					this.pending_score = data.score != this.data.score;
				}
			}
		}

		if (this.pending_piece) {
			this.pending_piece = false;
			this.onPiece(data); // updates state
		} else {
			if (this.IS_CLASSIC_ROM) {
				const num_pieces = this._getNumPieces(data);

				if (num_pieces != this.num_pieces) {
					this.pending_piece = true;
				}
			} else {
				/* eslint-disable no-constant-condition */

				do {
					if (this._isSameField(data)) break;

					if (this.clear_animation_remaining_frames-- > 0) break;

					const block_diff = cur_num_blocks - this.num_blocks;

					switch (block_diff) {
						/* eslint-disable no-fallthrough */

						case 4:
							this.data.field = data.field;
							this.num_blocks = cur_num_blocks;
							this.pending_piece = true;
							break;

						case -8:
							this.onTetris();
						case -6:
							this.clear_animation_remaining_frames =
								LINE_CLEAR_IGNORE_FRAMES - 1;
							this.num_blocks += block_diff * 5; // equivalent to fast forward on how many blocks will have gone after the animation
							break;

						case -4:
							if (this.pending_single) {
								this.clear_animation_remaining_frames =
									LINE_CLEAR_IGNORE_FRAMES - 2;
								this.num_blocks -= 10;
							} else {
								this.clear_animation_remaining_frames =
									LINE_CLEAR_IGNORE_FRAMES - 1;
								this.num_blocks -= 20;
							}

							this.pending_single = false;
							break;

						case -2:
							// -2 can happen on the first clear animation frame of a single
							// -2 can also happen when the piece is at the top of the field and gets rotated and is then partially off field
							// to differentiate the 2, we must wait for the next frame, if it goes to -4, then it is the clear animation continuing
							this.pending_single = true;
							break;

						default:
							// We ignore invalid block count diffs. In many cases these dut to interlace artefacts when the pieces rotate of move
							// TODO: block count tracking can fall out of sync, breaking piece count events. CCan anything be done to restore a "clean" count and resume
							this.pending_single = false;
					}
				} while (false);
			}
		}

		// Check board for gameover event (curtain has fallen)
		if (cur_num_blocks >= 200) {
			this.end();
		} else if (this._isNoCurtainTopOut(data)) {
			this.end();
		}
	}

	_isRowEmpty(field, rowIdx) {
		for (let colIdx = 10; colIdx--; ) {
			if (field[rowIdx * 10 + colIdx]) return false;
		}
		return true;
	}

	_isNoCurtainTopOut(data) {
		// topped out if:
		// 1. all rows have blocks
		// 2. top row hasn't changed over some frames
		// 3. 1150ms of nothing new happening

		for (let rowidx = 0; rowidx < 20; rowidx++) {
			if (this._isRowEmpty(data.field, rowidx)) {
				this.pending_topout = false;
				this.pending_topout_start_ts = 0;

				return false;
			}
		}

		if (!this.pending_topout) {
			// first frame of potential top out - record top 2 rows for later
			this.pending_topout = data.field.slice(0, 20);
			this.pending_topout_start_ts = Date.now();

			return false;
		}

		if (
			!this.pending_topout.every((cell, idx) => !(!cell ^ !data.field[idx]))
		) {
			// top 2 rows have changed, record current top 2 rows as new state of potential top out again
			this.pending_topout = data.field.slice(0, 20);
			this.pending_topout_start_ts = Date.now();

			return false;
		}

		if (Date.now() - this.pending_topout_start_ts < 1150) {
			// We wait till 1.150 seconds have elapsed
			return false;
		}

		return true;
	}

	_doGameOver() {
		this.over = true;
		this.end_ts = Date.now();

		if (this.save_frame) {
			this.frame_stream?.end();
		}

		if (this.frame_count <= 2 || this.num_frames <= 2) {
			// TODO: do we really need 2 frame counters?
			// TODO: How to delete game file?
			return;
		}

		const report = this.getReport();

		if (!report || report.score == null) {
			console.log('Block reporting of null score');
			return;
		}

		this.recordGame(report);
	}

	async recordGame(report) {
		let score_id = null;

		try {
			score_id = await ScoreDAO.recordGame(this.user, report);
			console.log(
				`Recorded new game for user ${this.user.login} (${this.user.id}) with id ${score_id}`
			);
			this.user.send(['scoreRecorded', this.user.id, score_id]);
		} catch (err) {
			console.log('Unable to record game');
			console.error(err);
			// TODO delete replay file too
		}

		if (!global.__ntc_event_name) return;
		if (!score_id) return;
		if (!this.user.on_behalf_of_user) return;

		try {
			// TODO: retrieve event name from a module rather than global scope
			await ScoreDAO.recordQualResult(
				this.user,
				this.user.on_behalf_of_user,
				score_id,
				global.__ntc_event_name
			);
			console.log(
				`Recorded new qual result for event ${global.__ntc_event_name}`
			);
		} catch (err) {
			console.log('Unable to record qual result');
			console.error(err);
			// TODO delete replay file too
		}
	}

	_isSameField(data) {
		return data.field.every((cell, idx) => cell === this.data.field[idx]);
	}

	_getNumBlocks(data) {
		return data.field.reduce((acc, cell) => acc + (cell ? 1 : 0), 0);
	}

	_getNumPieces(data) {
		return PIECES.reduce((acc, p) => acc + (data[p] || 0), 0);
	}

	onScore(data) {
		const cleared = data.lines - this.data.lines;
		const line_score = (SCORE_BASES[cleared] || 0) * (data.level + 1);

		if (data.score === 999999 && this.data.score + line_score >= 999999) {
			// Compute score beyond maxout
			this.data.score += line_score;
		} else if (data.score < this.data.score) {
			const num_wraps = Math.floor((this.data.score + line_score) / 1600000);

			if (num_wraps >= 1) {
				// Using Hex score Game Genie code XNEOOGEX
				// The GG code makes the score display wrap around to 0
				// when reaching 1,600,000. We correct accordingly here.
				this.data.score = 1600000 * num_wraps + data.score;
			} else {
				// weird reading
				// but we take the new value anyway 🤷‍♂️
				this.data.score = data.score;
			}
		} else {
			this.data.score = data.score;
		}

		// when score changes, lines may have changed
		if (cleared) {
			this.data.lines = data.lines;

			this.clears.push(cleared);

			if (cleared === 4) {
				this.tetris_lines += cleared;
			}

			// when line changes, level may have changed
			if (data.level != this.data.level) {
				this.data.level = data.level;

				if (this.transition === null) {
					this.transition = data.score;
					this.onTransition();
				}
			}
		}
	}

	onPiece(data) {
		let cur_piece;

		do {
			if (data.cur_piece !== null) {
				cur_piece = data.cur_piece; // 💪
				break;
			} else if (this.IS_CLASSIC_ROM) {
				if (this.num_pieces === 0) {
					cur_piece = PIECES.find(p => data[p]); // first truthy value is piece
					break;
				}
			}

			cur_piece = this.prior_preview; // should be in sync 🤞
		} while (false);

		if (this.IS_CLASSIC_ROM) {
			// record new state
			this.num_pieces = this._getNumPieces(data);
			PIECES.forEach(p => (this.data[p] = data[p]));
		}

		this.pieces.push(cur_piece);
		this.prior_preview = data.preview;

		if (cur_piece == 'I') {
			if (this.cur_drought > this.max_drought) {
				this.max_drought = this.cur_drought;
			}

			this.cur_drought = 0;
		} else {
			if (++this.cur_drought === 13) {
				this.num_droughts += 1;
			}
		}

		if (data.cur_piece_das !== null) {
			this.das_total += data.cur_piece_das;
		}
	}

	getReport() {
		if (!this.data) return null;

		let tetris_rate = null;
		let das_avg = -1;

		if (this.clears.length) {
			tetris_rate = this.tetris_lines / this.data.lines;
		}

		if (this.pieces.length && this.das_total) {
			das_avg = this.das_total / this.pieces.length;
		}

		return {
			start_level: this.start_level,
			end_level: this.data.level,
			score: this.data.score,
			lines: this.data.lines,
			num_droughts: this.num_droughts,
			max_drought: this.max_drought,
			duration: (this.end_ts || Date.now()) - this.start_ts,
			transition: this.transition,
			clears: this.clears.join(''),
			pieces: this.pieces.join(''),

			tetris_rate,
			das_avg,

			num_frames: this.num_frames,
			frame_file: this.frame_file,

			competition: this.competition,
		};
	}

	saveFrame(frame) {
		this.last_frame_ts = Date.now();

		if (this.save_frame) {
			this.num_frames++;
			this.frame_stream.write(frame);
		}
	}

	// TODO: change callbacks to emit events instead
	onGameOver() {}
	onTetris() {}
	onTransition() {}
	onNewGame() {}
}

export default Game;
