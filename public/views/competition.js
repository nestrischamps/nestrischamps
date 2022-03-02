import Connection from '/js/connection.js';
import { TRANSITIONS } from '/views/constants.js';

// very simple RPC system to allow server to send data to client

let players;

function getPlayer(idx) {
	return players[idx];
}

function tetris_value(level) {
	return 1200 * (level + 1);
}

function getSortedPlayers(players, getter = 'getScore') {
	return players.concat().sort((p1, p2) => {
		const p1_score = p1[getter]();
		const p2_score = p2[getter]();

		if (isNaN(p1_score)) return -1;
		if (isNaN(p2_score)) return 1;

		return p2_score - p1_score;
	});
}

export function getTetrisDiff(leader, laggard, getter = 'getScore') {
	const leader_score = leader[getter]();
	const laggard_score = laggard[getter]();

	if (leader_score === laggard_score) return 0;

	const transition = TRANSITIONS[laggard.start_level];

	let level = laggard.level;
	let lines = laggard.lines;
	let tetrises = 0;
	let diff = leader_score - laggard_score;

	while (diff > 0) {
		if (lines >= transition - 4) {
			// below transition, level doesn't change every 10 lines
			if (lines % 10 >= 6) {
				// the tetris is counted at end level, not start level
				level += 1;
			}
		}

		lines += 4;
		tetrises += 1;

		diff -= tetris_value(level);
	}

	//  correct the overshot
	//  note: diff is negative, to this statement *reduces* the tetrises value
	tetrises += diff / tetris_value(level);

	return tetrises;
}

class TetrisCompetitionAPI {
	constructor() {
		this.first_to = 3; // defaults to Best of 5

		this.resetVictories();
	}

	resetVictories() {
		this.victories = players.map(p => 0);

		players.forEach((player, idx) => {
			this._repaintVictories(idx);
			player.clearField();
		});
	}

	setId(player_idx, id) {
		getPlayer(player_idx).setId(id);
	}

	setPeerId(player_idx, peerid) {
		getPlayer(player_idx).setPeerId(peerid);
	}

	setSecondaryView() {
		// overload as needed
	}

	setLogin(player_idx, login) {
		getPlayer(player_idx).setLogin(login);
	}

	setName(player_idx, name) {
		getPlayer(player_idx).setName(name);
	}

	setAvatar(player_idx, avatar_url) {
		getPlayer(player_idx).setAvatar(avatar_url);
	}

	// Twitch like command aliases
	setProfileImageURL(player_idx, avatar_url) {
		this.setAvatar(player_idx, avatar_url);
	}

	setDisplayName(player_idx, name) {
		this.setName(player_idx, name);
	}

	setFirstTo(num_games_to_win) {
		this.first_to = num_games_to_win;

		this.victories.forEach((num, idx) => {
			this.setVictories(idx, num);
		});
	}

	setBestOf(num_games) {
		this.setFirstTo(Math.ceil(num_games / 2));
	}

	setVictories(player_idx, num_victories) {
		this.victories[player_idx] = num_victories;

		this._repaintVictories(player_idx);
	}

	setWinner(player_idx) {
		players.forEach((player, pidx) => {
			if (pidx === player_idx) {
				player.playWinnerAnimation();
			} else {
				player.showLoserFrame();
			}
		});
	}

	showProfileCard(visible) {
		players.forEach(player => player.showProfileCard(visible));
	}

	setGameOver(player_idx) {
		getPlayer(player_idx).setGameOver();
	}

	cancelGameOver(player_idx) {
		getPlayer(player_idx).cancelGameOver();
	}

	_repaintVictories(player_idx) {
		const player = getPlayer(player_idx);
		const victories = this.victories[player_idx];

		const hearts = player.dom.hearts;

		// clear all the hearts
		while (hearts.childNodes.length) {
			hearts.removeChild(hearts.childNodes[0]);
		}

		// reset to specified value
		for (let idx = 0; idx < this.first_to; idx++) {
			const heart = document.createElement('span');

			heart.innerHTML = '&#338;'; // represented as a heart in the font

			if (idx < victories) {
				heart.classList.add('win');
			}

			const insert_method = player.render_wins_rtl ? 'prepend' : 'appendChild';

			hearts[insert_method](heart);
		}
	}

	frame(player_idx, data) {
		const player = getPlayer(player_idx);

		if (!player) return;

		player.setFrame(data);
	}

	setSecondaryView() {
		// TODO: the player video streams will end, should clear the view
	}
}

// TODO: modularize this file better
export default class Competition {
	constructor(_players) {
		this.players = players = _players;

		this._onPlayerScoreChanged = this._onPlayerScoreChanged.bind(this);

		players.forEach(player => {
			player.onScore = this._onPlayerScoreChanged;
		});

		this.API = new TetrisCompetitionAPI();

		try {
			this.connection = new Connection(null, view_meta); // sort of gross T_T
		} catch (_err) {
			this.connection = new Connection();
		}

		this.connection.onMessage = frame => {
			try {
				const [method, ...args] = frame;

				this.API[method](...args);
			} catch (e) {
				// socket.close();
				console.error(e);
				console.log(frame);
			}
		};
	}

	computeScoreDifferentials(_players) {
		if (!_players) _players = this.players;

		const winner_slice_ratio = 1 / (_players.length - 1);

		// score change, we need to update all the diffs
		[
			{ getter: 'getScore', setter: 'setDiff' },
			{ getter: 'getGameRunwayScore', setter: 'setGameRunwayDiff' },
			{ getter: 'getProjection', setter: 'setProjectionDiff' },
		].forEach(({ getter, setter }) => {
			const sorted_players = getSortedPlayers(_players, getter);

			// handle score diff between player 0 and 1
			const diff = sorted_players[0][getter]() - sorted_players[1][getter]();

			if (!isNaN(diff)) {
				const t_diff = getTetrisDiff(
					sorted_players[0],
					sorted_players[1],
					getter
				);

				sorted_players[0][setter](diff, t_diff, 0);
				sorted_players[1][setter](diff, t_diff, winner_slice_ratio);
			}

			for (let pidx = 2; pidx < sorted_players.length; pidx++) {
				const leader = sorted_players[pidx - 1];
				const laggard = sorted_players[pidx];

				const diff = leader[getter]() - laggard[getter]();

				if (isNaN(diff)) continue;

				const t_diff = getTetrisDiff(leader, laggard, getter);

				laggard[setter](diff, t_diff, pidx * winner_slice_ratio);
			}
		});
	}

	_onPlayerScoreChanged() {
		this.computeScoreDifferentials();
	}

	getPlayerIndexByPeerId(peerid) {
		return this.players.findIndex(player => player.peerid === peerid);
	}

	getPlayersByPeerId(peerid) {
		return this.players.filter(player => player.peerid === peerid);
	}
}
