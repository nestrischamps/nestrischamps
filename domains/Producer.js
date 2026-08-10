import EventEmitter from 'events';
import Game from '../modules/Game.js';

function parseBoolean(val) {
	if (typeof val === 'string') {
		const lower = val.trim().toLowerCase();
		if (lower === 'true' || lower === '1') return true;
		if (lower === 'false' || lower === '0') return false;
	}
	return !!val;
}

class Producer extends EventEmitter {
	constructor(user) {
		super();

		this.user = user;

		this.connection = null;
		this.is_match_connection = false;
		this.game = null;

		this._handleMessage = this._handleMessage.bind(this);
	}

	setConnection(
		connection,
		{ match = false, competition = false, remote_calibration = false }
	) {
		this.kick('concurrency_limit');

		this.is_match_connection = !!match;
		this.is_competition = !!match || !!competition;
		this.remote_calibration = !!remote_calibration;

		connection.on('message', this._handleMessage);

		connection.once('close', () => {
			this.connection.removeAllListeners();

			if (this.connection === connection) {
				this.connection = null;
				this.endGame();
				this.emit('close');
			}
		});

		connection.once('error', err => {
			this.endGame();
			this.emit('error', err);
		});

		this.connection = connection;

		this.connection.send(['setVdoNinjaURL', this.user.vdo_ninja_url]);
	}

	hasConnection() {
		return !!this.connection;
	}

	isMatchConnection() {
		return this.is_match_connection;
	}

	setCompetition(competition) {
		this.is_competition = parseBoolean(competition);
		if (this.game && !this.game.over) {
			this.game.setCompetition(this.is_competition);
		}
	}

	setGame() {
		if (this.game) {
			delete this.game.onNewGame;
		}

		this.game = new Game(this.user, {
			competition: this.is_competition,
		});

		this.game.onNewGame = frame => {
			console.log(
				`${this.user.login} (${this.user.id}) is starting a new game`
			);

			this.setGame();

			this.game.setFrame(frame);
		};
	}

	endGame() {
		if (this.game) {
			this.game.end();
			this.game = null;
		}
	}

	kick(reason) {
		if (this.connection) {
			this.connection.kick(reason);
			this.endGame();
		}
	}

	getPeerId() {
		if (this.connection) {
			return this.connection.id;
		}
		return '';
	}

	send(message) {
		if (this.connection) {
			this.connection.send(message);
		}
	}

	_handleMessage(message) {
		if (Array.isArray(message) && message[0] === 'setCompetition') {
			this.setCompetition(message[1]);
		}

		if (!this.game) {
			this.setGame();
		}

		if (message instanceof Uint8Array) {
			// this is a game frame, we track it in the game instance
			this.game.setFrame(message); // this call may reset the game as side effect
		}

		this.emit('message', message);
	}
}

export default Producer;
