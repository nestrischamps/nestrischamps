import dbPool from '../modules/db.js';

const SESSION_BREAK_MS = 2 * 60 * 58 * 1000; // 2hours - 2s for the time check query

class ScoreDAO {
	async getStats(user) {
		const db_client = await dbPool.connect();

		try {
			const data = {
				current_player: user.login,
				pbs: [
					await this._getPBs(db_client, user, 18),
					await this._getPBs(db_client, user, 19),
				],
				high_scores: {
					overall: await this._getBestOverall(db_client, user),
					session: await this._getBestInSession(db_client, user),
				},
			};

			// Temporary ... For backward compatibility - Remove after 2022-06-01
			data.high_scores.today = data.high_scores.session;

			return data;
		} catch (err) {
			console.log('Error getting user stats');
			console.error(err);
			return {};
		} finally {
			db_client.release();
		}
	}

	async _getPBs(db_client, user, start_level) {
		const result = await db_client.query(
			`
			SELECT start_level, end_level, score, lines, das_avg, max_drought, tetris_rate
			FROM scores
			WHERE player_id=$1 and start_level=$2
			ORDER BY score DESC
			LIMIT 1
			`,
			[user.id, start_level]
		);

		return result.rows[0];
	}

	async _getBestOverall(db_client, user) {
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
			ORDER BY score DESC
			LIMIT 10
			`,
			[user.id]
		);

		return result.rows;
	}

	async _getBest24Hours(db_client, user) {
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
				AND datetime >= NOW() - interval '24 hours'
				AND datetime <= NOW()
			ORDER BY score DESC
			LIMIT 10
			`,
			[user.id]
		);

		return result.rows;
	}

	async _getBestInSession(db_client, user) {
		const session = await this._getCurrentSessionId(user, db_client);
		const result = await db_client.query(
			`
			SELECT start_level, score, tetris_rate
			FROM scores
			WHERE player_id=$1
				AND session=$2
			ORDER BY score DESC
			LIMIT 10
			`,
			[user.id, session]
		);

		return result.rows;
	}

	async getPB(user, since = 0) {
		const result = await dbPool.query(
			`
				SELECT score
				FROM scores
				WHERE player_id = $1
				AND datetime >= to_timestamp($2)
				ORDER BY score DESC
				LIMIT 1
			`,
			[user.id, since]
		);

		try {
			return parseInt(result.rows[0].score, 10);
		} catch (err) {
			return 0;
		}
	}

	async getTop3(user, since = 0) {
		const result = await dbPool.query(
			`
				SELECT score, end_level
				FROM scores
				WHERE player_id = $1
				AND datetime >= to_timestamp($2)
				ORDER BY score DESC
				LIMIT 3
			`,
			[user.id, since]
		);

		try {
			return result.rows.map(row => {
				return {
					score: parseInt(row.score, 10),
					end_level: parseInt(row.end_level, 10),
				};
			});
		} catch (err) {
			return [];
		}
	}

	async _getCurrentSessionId(user, db_client = null) {
		const result = await (db_client || dbPool).query(
			`
			SELECT id, datetime, session
			FROM scores
			WHERE player_id=$1
			ORDER BY datetime DESC
			LIMIT 1
			`,
			[user.id]
		);

		const last_game = result.rows[0];

		let session = 1;

		if (last_game) {
			session = last_game.session;

			if (Date.now() - last_game.datetime > SESSION_BREAK_MS) {
				session += 1;
			}
		}

		return session;
	}

	async recordGame(user, game_data) {
		if (!game_data) return;

		const session = await this._getCurrentSessionId(user);
		const result = await dbPool.query(
			`
			INSERT INTO scores
			(
				datetime,
				player_id,
				session,
				start_level,
				end_level,
				score,
				lines,
				tetris_rate,
				num_droughts,
				max_drought,
				das_avg,
				duration,
				clears,
				pieces,
				transition,
				num_frames,
				frame_file,
				manual
			)
			VALUES
			(
				NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
			)
			RETURNING id
			`,
			[
				user.id,
				session,
				game_data.start_level,
				game_data.end_level,
				game_data.score,
				game_data.lines,
				game_data.tetris_rate,
				game_data.num_droughts,
				game_data.max_drought,
				game_data.das_avg,
				game_data.duration,
				(game_data.clears || '').slice(0, 600),
				(game_data.pieces || '').slice(0, 2400),
				game_data.transition,
				game_data.num_frames,
				game_data.frame_file,
				!!game_data.manual,
			]
		);

		return result.rows[0].id;
	}

	async getNumberOfScores(user) {
		const result = await dbPool.query(
			`
				SELECT count(*)
				FROM scores
				WHERE player_id=$1
			`,
			[user.id]
		);

		return parseInt(result.rows[0].count, 10);
	}

	async getScorePage(user, options = {}) {
		options = {
			sort_field: 'datetime',
			sort_order: 'desc',
			page_size: 100,
			page_idx: 0,

			...options,
		};

		let null_handling = '';

		if (options.sort_field === 'tetris_rate') {
			null_handling =
				options.sort_order === 'desc' ? 'NULLS last' : 'NULLS first';
		}

		// WARNING: this query uses plain JS variable interpolation, parameters MUST be sane
		const result = await dbPool.query(
			`
				SELECT id, datetime, start_level, end_level, score, lines, tetris_rate, num_droughts, max_drought, das_avg, duration, frame_file
				FROM scores
				WHERE player_id=$1
				ORDER BY ${options.sort_field} ${options.sort_order} ${null_handling}
				LIMIT ${options.page_size} OFFSET ${options.page_size * options.page_idx}
			`,
			[user.id]
		);

		return result.rows;
	}

	async deleteScore(user, score_id) {
		return dbPool.query(
			`
			DELETE FROM scores
			WHERE player_id=$1 AND id=$2
			`,
			[user.id, score_id]
		);
	}

	async getScore(user, score_id) {
		const result = await dbPool.query(
			`
			SELECT * FROM scores
			WHERE player_id=$1 AND id=$2
			`,
			[user.id, score_id]
		);

		return result.rows[0];
	}

	async getProgress(user, start_level = null) {
		const args = [user.id];
		let level_condition = '';

		if (start_level !== null && start_level >= 0 && start_level <= 29) {
			args.push(start_level);
			level_condition = `AND s.start_level=$2 `;
		}

		const result = await dbPool.query(
			`
			SELECT
				session,
				min(s.datetime) AS datetime,
				count(s.id) AS num_games,
				max(s.score) AS max_score,
				round(avg(s.score)) AS avg_score
			FROM scores s, twitch_users u
			WHERE s.player_id=$1 AND s.player_id=u.id ${level_condition}
			GROUP BY session
			ORDER BY session asc
			`,
			args
		);

		return result.rows;
	}

	async getAnonymousScore(score_id) {
		const result = await dbPool.query(
			`
			SELECT s.*, u.login, u.display_name, u.profile_image_url, u.country_code
			FROM scores s, twitch_users u
			WHERE s.player_id=u.id
				AND s.id=$1
			`,
			[score_id]
		);

		return result.rows[0];
	}

	async setPB(user, update) {
		const session = await this._getCurrentSessionId(user);

		// atomic upsert
		const result = await dbPool.query(
			`
			INSERT INTO scores
			(
				datetime,
				player_id,
				session,
				start_level,
				end_level,
				score,
				manual,

				lines,
				tetris_rate,
				num_droughts,
				max_drought,
				das_avg,
				duration,
				clears,
				pieces,
				transition,
				num_frames,
				frame_file
			)
			VALUES
			(
				NOW(), $1, $2, $3, $4, $5, true, 0, 0, 0, 0, -1, 0, '', '', 0, 0, ''
			)
			ON CONFLICT (player_id, start_level) where manual
			DO UPDATE SET datetime=NOW(), end_level=$4, score=$5
			`,
			[user.id, session, update.start_level, update.end_level, update.score]
		);

		return result.rowCount === 1;
	}

	async getRoundScores(players, start_ts, end_ts) {
		const player_ids = players.map(p => p.id);

		const result = await dbPool.query(
			`
			SELECT
				s.player_id, u.login,
				s.id,
				(s.datetime - (s.duration || ' milliseconds')::interval) as start_time,
				s.datetime as end_time,
				s.duration,
				s.score, s.start_level, s.lines, s.end_level, s.tetris_rate
			FROM scores s, twitch_users u
			WHERE s.player_id=u.id
				AND s.player_id in (${player_ids.join(',')})
				AND (s.datetime - (s.duration || ' milliseconds')::interval) >= to_timestamp($1)
				AND datetime < to_timestamp($2)
			`,
			[start_ts, end_ts]
		);

		// group results by player and return
		const res_by_player = {};

		result.rows.forEach(row => {
			let player_data = res_by_player[row.login];

			if (!player_data) {
				player_data = res_by_player[row.login] = {
					id: row.player_id,
					login: row.login,
					games: [],
				};
			}

			delete row.player_id;
			delete row.login;

			player_data.games.push(row);
		});

		return res_by_player;
	}
}

export default new ScoreDAO();
