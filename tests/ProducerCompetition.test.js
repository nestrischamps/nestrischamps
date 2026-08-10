import EventEmitter from 'events';
import Producer from '../domains/Producer.js';
import BinaryFrame from '../public/js/BinaryFrame.js';

class MockConnection extends EventEmitter {
	constructor() {
		super();
		this.id = 'NTC123';
		this.meta = {};
	}
	send() {}
	kick() {}
}

describe('Producer Competition Flag RPC', () => {
	let user;
	let connection;
	let producer;

	beforeEach(() => {
		user = {
			id: 1,
			login: 'testuser',
			vdo_ninja_url: '',
		};
		producer = new Producer(user);
		connection = new MockConnection();
	});

	function createBinaryFrame(gameid = 1, score = 0, lines = 0, level = 18) {
		const frameObj = {
			gameid,
			ctime: Date.now(),
			game_type: BinaryFrame.GAME_TYPE.CLASSIC,
			level,
			lines,
			score,
			lines_stats: Array(25).fill(0),
			piece_stats: Array(7).fill(0),
			field: Array(200).fill(0),
			preview: 'T',
			cur_piece: 'I',
			cur_piece_das: 10,
			instant_das: 5,
		};
		return BinaryFrame.encode(frameObj);
	}

	it('should initialize producer with competition: false when connected with competition=0', () => {
		producer.setConnection(connection, { competition: false });
		expect(producer.is_competition).toBe(false);
	});

	it('should initialize producer with competition: true when connected with competition=1', () => {
		producer.setConnection(connection, { competition: true });
		expect(producer.is_competition).toBe(true);
	});

	it('should update competition flag when receiving setCompetition RPC message before game starts', () => {
		producer.setConnection(connection, { competition: false });
		expect(producer.is_competition).toBe(false);

		connection.emit('message', ['setCompetition', 1]);
		expect(producer.is_competition).toBe(true);

		const frame = createBinaryFrame(1);
		connection.emit('message', frame);

		expect(producer.game).not.toBeNull();
		expect(producer.game.competition).toBe(true);
	});

	it('should update ongoing game competition flag when receiving setCompetition RPC during game', () => {
		producer.setConnection(connection, { competition: false });

		const frame1 = createBinaryFrame(1, 0, 0, 18);
		connection.emit('message', frame1);

		expect(producer.game).not.toBeNull();
		expect(producer.game.competition).toBe(false);

		// Switch competition flag to true during ongoing game
		connection.emit('message', ['setCompetition', 1]);

		expect(producer.is_competition).toBe(true);
		expect(producer.game.competition).toBe(true);

		// Game report reflects the new competition value
		const report = producer.game.getReport();
		expect(report.competition).toBe(true);
	});

	it('should allow switching competition flag from true to false during ongoing game', () => {
		producer.setConnection(connection, { competition: true });

		const frame1 = createBinaryFrame(1, 0, 0, 18);
		connection.emit('message', frame1);

		expect(producer.game.competition).toBe(true);

		// Switch competition flag to false
		connection.emit('message', ['setCompetition', 0]);

		expect(producer.is_competition).toBe(false);
		expect(producer.game.competition).toBe(false);

		const report = producer.game.getReport();
		expect(report.competition).toBe(false);
	});

	it('should pass updated competition flag to subsequent games on the same connection', () => {
		producer.setConnection(connection, { competition: false });

		// Game 1
		const frame1 = createBinaryFrame(1, 100, 1, 18);
		connection.emit('message', frame1);
		expect(producer.game.competition).toBe(false);

		// Switch flag
		connection.emit('message', ['setCompetition', true]);

		// End Game 1 and Start Game 2
		const frame2 = createBinaryFrame(2, 0, 0, 18);
		connection.emit('message', frame2);

		expect(producer.game.competition).toBe(true);
	});

	it('should support various truthy and falsy representations for setCompetition (booleans, numbers, strings)', () => {
		producer.setConnection(connection, { competition: false });

		connection.emit('message', ['setCompetition', '1']);
		expect(producer.is_competition).toBe(true);

		connection.emit('message', ['setCompetition', '0']);
		expect(producer.is_competition).toBe(false);

		connection.emit('message', ['setCompetition', 'true']);
		expect(producer.is_competition).toBe(true);

		connection.emit('message', ['setCompetition', 'false']);
		expect(producer.is_competition).toBe(false);
	});
});
