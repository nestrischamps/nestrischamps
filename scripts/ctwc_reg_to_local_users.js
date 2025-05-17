// Sample Attendee Sheet
// https://docs.google.com/spreadsheets/d/13ylAk77UR_5V3zyVxpAlYFiHtouKiIoQu9DVOcyTibM/edit?usp=sharing
// 1. Make a copy
// 2. Fill it
// 3. Publish Sheet 1 to Web as CSV
// 4. update the sheet csv export URL below
// 5. run script as:
// node scripts/insert_local_users.js

import pg from 'pg';
import { parse } from 'csv-parse/sync';
import ULID from 'ulid';
import got from 'got';
import assert from 'assert';
import { pbkdf2 } from 'crypto';

// replace this URL by the sheet that contains your data
// get the url by doing: File > Share > Publish to web > Sheet 1 > CSV
const sheet_csv_url = process.env.CSV_URL;

function identity(v) {
	return v;
}

(async function () {
	const records_csv_content = await got(sheet_csv_url).text();
	const records = parse(records_csv_content, {
		skip_empty_lines: true,
	});

	const START_ID = 33;
	const errors = [];

	// BEWARE - Hardcoded order of fields from sheet
	const CSV_FIELDS = [
		'seed',
		'country',
		'display_name',
		'pronouns',
		'twitch',
		'controller',
		'pb18',
		'pb19',
		'lines29',
		'pb29',
		'highest_level',
		'num_maxouts',
		'age',
		'job',
		'style',
		'rival',
		'favourite_other_game',
		'favourite_sport_team',
		'num_year_qualified_ctwc',
		'highest_rank_and_year',
		'achievements',
		'other_game',
		'hobbies',
	];

	// 1. we extract all records from the sheet and convert that in NTC-compatible player data
	const players = records.slice(1).map((record, index) => {
		const id = START_ID + index - 1;
		const csv = Object.fromEntries(
			CSV_FIELDS.map((key, i) => [key, record[i]])
		);

		// verify numeric fields
		const numeric_fields = [
			'seed',
			'pb18',
			'pb19',
			'pb29',
			'lines29',
			'highest_level',
			'num_maxouts',
			'age',
		];

		// verify numeric values
		for (const field of numeric_fields) {
			if (!/^([1-9]\d*(\.\d*[1-9])?(E\+\d+)?|)$/.test(csv[field].trim())) {
				errors.push({
					index,
					csv,
					err: `${csv[field]} is not a valid value`,
				});
			}
		}

		if (csv.display_name.length > 11) {
			errors.push({
				index,
				csv,
				err: `short name is longer than 10 characters (${csv.display_name.length} chars)`,
			});
		}

		if (Math.trunc(Number(csv.num_maxouts)) > 10000) {
			errors.push({
				index,
				csv,
				err: `Number of maxout > 10,000 (${csv.num_maxouts})`,
			});
		}

		return { id, csv };
	});

	console.log(players);

	// show all errors by row for quick fixes
	if (errors.length) {
		errors.sort((e1, e2) => e1.index - e2.index);
		console.error(`ERROR: Unexpected values found in data sheet - Aborting`);
		console.error('----------');
		console.error(
			errors
				.map(
					({ index, csv, err }) =>
						`row ${index + 2} (${csv.display_name}): ${err}`
				)
				.join('\n')
		);
		process.exit(1);
	}

	process.exit(2);

	// 2. Derive NTC values
	players.forEach(player => {
		const { id, csv } = player;

		// prep ntc mapped values
		const ntc = {
			id,
			login: /^\s*$/.test(csv.twitch) ? `__user${id}` : csv.twitch,
			email: `__user${id}@nestrischamps.io`,
			display_name: csv.seed
				? `${csv.seed}. ${csv.display_name}`
				: csv.display_name,
			secret: ULID.ulid(),
			description: [csv.job, csv.achievements].filter(identity).join(', '), // do we want that default?? probably not
			pronouns: csv.pronouns.trim(),
			profile_image_url: '',
			dob: new Date(),
			country_code: 'US',
			city: '',
			interests: [
				csv.hobbies,
				csv.favourite_other_game,
				csv.favourite_sport_team,
			]
				.filter(identity)
				.join(', '),
			style: csv.style,
			elo_rank: null,
			elo_rating: null,
		};

		const age = parseInt(csv.age, 10);
		const dob = ntc.dob;
		dob.setFullYear(dob.getFullYear() - age);
		dob.setDate(dob.getDate() - 1);

		player.ntc = ntc;
	});

	console.log(players);
	process.exit(1);

	// 3. Inject NTC record into DB!
	for (const [index, { id, csv, ntc }] of records.entries()) {
		if (index === 0) continue; // header row

		const {
			seed,
			login,
			display_name,
			pronouns,
			personal_best,
			elo_rank,
			elo_rating,
			description,
			dob,
			country_code,
			city,
			interests,
			style,
			profile_image_url,
		} = ntc;

		await pool.query(
			`INSERT INTO twitch_users
			(id, login, email, secret, description, display_name, pronouns, profile_image_url, dob, country_code, city, interests, style, elo_rank, elo_rating, created_on, last_login)
			VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
			`,
			[
				id,
				/^\s*$/.test(login) ? `__user${id}` : login,
				`__user${id}@nestrischamps.io`,
				ULID.ulid(),
				description,
				seed ? `${seed}. ${display_name}` : display_name,
				pronouns,
				profile_image_url,
				dob,
				country_code,
				city,
				interests,
				style,
				elo_rank,
				elo_rating,
			]
		);

		await pool.query(
			`
			INSERT INTO scores
			(
				datetime,

				player_id,
				start_level,
				end_level,
				score,

				competition,
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
				NOW(),
                $1, $2, $3, $4,
                false, true, 0, 0, 0, 0, -1, 0, '', '', 0, 0, ''
			)
			`,
			[id, 18, 18, parseInt(personal_best, 10)]
		);
	}

	process.exit(0);
})();
