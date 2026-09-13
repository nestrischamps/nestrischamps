import EventEmitter from 'events';
import MatchRoom from '../domains/MatchRoom.js';

class MockConnection extends EventEmitter {
	constructor(meta = {}) {
		super();
		this.id = 'MOCK_' + Math.random().toString(36).substring(2, 8);
		this.meta = meta;
		this.messages = [];
		this.user = { id: 1, login: 'testuser' };
	}
	send(msg) {
		this.messages.push(msg);
	}
	kick() {}
}

describe('MatchRoom Concurrent Matches & setMatch', () => {
	let owner;
	let room;

	beforeEach(() => {
		owner = { id: 1, login: 'testuser' };
		room = new MatchRoom(owner);
	});

	it('should initialize with concurrent_matches: 0 and concurrent_2_matches: undefined', () => {
		expect(room.state.concurrent_matches).toBe(0);
		expect(room.state.concurrent_2_matches).toBeUndefined();
		expect(room.state.selected_match).toBeNull();
	});

	it('should update concurrent_2_matches when a 2-match view connects', () => {
		const view = new MockConnection({
			_concurrent_2_matches: 'true',
			_players: '4',
		});

		room.addView(view, true);

		expect(room.state.concurrent_2_matches).toBe(true);
		expect(room.state.concurrent_matches).toBe(2);
	});

	it('should update concurrent_matches to 4 when a 4-match view connects', () => {
		const view = new MockConnection({
			_concurrent_matches: '4',
			_players: '8',
		});

		room.addView(view, true);

		expect(room.state.concurrent_2_matches).toBe(false);
		expect(room.state.concurrent_matches).toBe(4);
	});

	it('should handle setMatch for 4 matches (0, 1, 2, 3, "all")', () => {
		const view = new MockConnection({
			_concurrent_matches: '4',
			_players: '8',
		});
		room.addView(view, true);

		const admin = new MockConnection();
		admin.user = owner;
		room.setAdmin(admin);

		// test match indices 0, 1, 2, 3
		[0, 1, 2, 3].forEach(matchIdx => {
			room.handleAdminMessage(['setMatch', matchIdx]);
			expect(room.state.selected_match).toBe(matchIdx);
			expect(view.messages[view.messages.length - 1]).toEqual([
				'setMatch',
				matchIdx,
			]);
		});

		// test "all"
		room.handleAdminMessage(['setMatch', 'all']);
		expect(room.state.selected_match).toBe('all');
		expect(view.messages[view.messages.length - 1]).toEqual([
			'setMatch',
			'all',
		]);
	});

	it('should send current selected_match to newly connected views when concurrent_matches is 4', () => {
		const view1 = new MockConnection({
			_concurrent_matches: '4',
			_players: '8',
		});
		room.addView(view1, true);

		const admin = new MockConnection();
		admin.user = owner;
		room.setAdmin(admin);

		room.handleAdminMessage(['setMatch', 2]);

		const view2 = new MockConnection({
			_concurrent_matches: '4',
			_players: '8',
		});
		room.addView(view2, false);

		expect(view2.messages).toContainEqual(['setMatch', 2]);
	});
});
