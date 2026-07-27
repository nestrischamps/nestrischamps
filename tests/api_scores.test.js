import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import config from '../modules/config.js';
import UserDAO from '../daos/UserDAO.js';
import ScoreDAO from '../daos/ScoreDAO.js';
import apiRouter from '../routes/api.js';

describe('Score History API & Configuration', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('Config', () => {
		it('should have server.max_page defaulting to 100', () => {
			expect(config.get('server.max_page')).toBe(100);
		});
	});

	describe('Authentication & Middleware', () => {
		it('should reject missing or invalid x-ntc-secret header with 401', async () => {
			const req = { headers: {}, query: {} };
			const res = {
				status: jest.fn().mockReturnThis(),
				json: jest.fn(),
			};
			const next = jest.fn();

			// find extractSecret layer in router stack
			const extractSecretLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[0].handle;

			await extractSecretLayer(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({
				error: 'Invalid or missing Bearer token',
			});
			expect(next).not.toHaveBeenCalled();
		});

		it('should accept x-ntc-secret with raw secret', async () => {
			const extractSecretLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[0].handle;

			const req = { headers: { 'x-ntc-secret': 'PLAYER1' }, query: {} };
			const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
			const next = jest.fn();
			await extractSecretLayer(req, res, next);
			expect(req.secret).toBe('PLAYER1');
			expect(next).toHaveBeenCalled();
		});

		it('should reject non-existent user with 401', async () => {
			const spy = jest
				.spyOn(UserDAO, 'getUserBySecret')
				.mockResolvedValue(null);

			const checkUserLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[1].handle;

			const req = { secret: 'PLAYER1' };
			const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
			const next = jest.fn();

			await checkUserLayer(req, res, next);

			expect(spy).toHaveBeenCalledWith('PLAYER1');
			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
			expect(next).not.toHaveBeenCalled();
		});
	});

	describe('Score Retrieval Logic', () => {
		const mockUser = { id: 42, login: 'testplayer' };
		const mockScores = [
			{
				id: 101,
				datetime: new Date('2026-07-27T10:00:00Z'),
				start_level: 18,
				end_level: 29,
				score: 999999,
				lines: 230,
				tetris_rate: 0.65,
				num_droughts: 3,
				max_drought: 18,
				das_avg: 12.5,
				duration: 420,
				frame_file: null,
				competition: false,
			},
		];

		it('should return score history with default sorting and pagination', async () => {
			jest.spyOn(UserDAO, 'getUserBySecret').mockResolvedValue(mockUser);
			const countSpy = jest
				.spyOn(ScoreDAO, 'getNumberOfScores')
				.mockResolvedValue(1);
			jest.spyOn(ScoreDAO, 'getScorePage').mockResolvedValue(mockScores);

			const handleGetScoresLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[2].handle;

			const req = {
				user: mockUser,
				query: {},
				protocol: 'http',
				headers: { host: 'localhost:5000' },
			};
			const res = { json: jest.fn() };

			await handleGetScoresLayer(req, res);

			expect(countSpy).toHaveBeenCalledWith(
				mockUser,
				expect.objectContaining({
					sort_field: 'datetime',
					sort_order: 'desc',
					page_size: 100,
					page_idx: 0,
				})
			);

			expect(res.json).toHaveBeenCalledWith({
				scores: mockScores,
				pagination: {
					total_scores: 1,
					page_idx: 0,
					page_size: 100,
					num_pages: 1,
				},
				query: {
					sort_field: 'datetime',
					sort_order: 'desc',
					level: null,
					competition: null,
				},
			});
		});

		it('should respect custom page_size within min page size 20 and max_page limit', async () => {
			jest.spyOn(UserDAO, 'getUserBySecret').mockResolvedValue(mockUser);
			const countSpy = jest
				.spyOn(ScoreDAO, 'getNumberOfScores')
				.mockResolvedValue(1200);
			jest.spyOn(ScoreDAO, 'getScorePage').mockResolvedValue([]);

			const handleGetScoresLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[2].handle;

			const req = {
				user: mockUser,
				query: {
					sort_field: 'score',
					sort_order: 'asc',
					page_size: '50', // valid page size between 20 and 100
					page_idx: '1',
					level: '19',
					competition: '1',
				},
				protocol: 'http',
				headers: { host: 'localhost:5000' },
			};
			const res = { json: jest.fn() };

			await handleGetScoresLayer(req, res);

			expect(countSpy).toHaveBeenCalledWith(
				mockUser,
				expect.objectContaining({
					sort_field: 'score',
					sort_order: 'asc',
					page_size: 50,
					page_idx: 1,
					level: 19,
					competition: true,
				})
			);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					pagination: expect.objectContaining({
						total_scores: 1200,
						page_idx: 1,
						page_size: 50,
						num_pages: 24,
					}),
					query: {
						sort_field: 'score',
						sort_order: 'asc',
						level: 19,
						competition: true,
					},
				})
			);
		});

		it('should reject page_size less than 20 and fallback to max_page_size', async () => {
			jest.spyOn(UserDAO, 'getUserBySecret').mockResolvedValue(mockUser);
			const countSpy = jest
				.spyOn(ScoreDAO, 'getNumberOfScores')
				.mockResolvedValue(100);
			jest.spyOn(ScoreDAO, 'getScorePage').mockResolvedValue([]);

			const handleGetScoresLayer = apiRouter.stack.find(
				s => s.route && s.route.path === '/user/scores'
			).route.stack[2].handle;

			const req = {
				user: mockUser,
				query: {
					page_size: '10', // Less than 20
				},
				protocol: 'http',
				headers: { host: 'localhost:5000' },
			};
			const res = { json: jest.fn() };

			await handleGetScoresLayer(req, res);

			expect(countSpy).toHaveBeenCalledWith(
				mockUser,
				expect.objectContaining({
					page_size: 100,
				})
			);
		});
	});
});
