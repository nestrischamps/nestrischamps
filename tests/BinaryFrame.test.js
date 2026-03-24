import BinaryFrame from '../public/js/BinaryFrame.js';

describe('BinaryFrame', () => {
	describe('encode and parse', () => {
		it('should correctly round-trip a basic frame for version 4', () => {
			const original = {
				game_type: BinaryFrame.GAME_TYPE.CLASSIC,
				player_num: 31, // Up to 5 bits map to 31
				gameid: 12345,
				ctime: Math.floor(Date.now() / 1000) & 0xfffffff, // 28 bits max
				lines: 2 ** 13 - 2, // -1 is the null value, -2 is the max value
				level: 2 ** 8 - 2,
				score: 2 ** 26 - 2,
				instant_das: 16, // 16 is max das value
				preview: 'T',
				cur_piece_das: 16, // 16 is max das value
				cur_piece: 'J',
				T: 2 ** 10 - 2,
				J: 2 ** 10 - 2,
				Z: 2 ** 10 - 2,
				O: 2 ** 10 - 2,
				S: 2 ** 10 - 2,
				L: 2 ** 10 - 2,
				I: 2 ** 10 - 2,
				field: Array.from({ length: 200 }, (_, i) => i % 3), // some non-zeros
			};

			const buffer = BinaryFrame.encode(original);

			// Version 4 size is 74
			expect(buffer.length).toBe(74);

			const parsed = BinaryFrame.parse(buffer);

			expect(parsed.version).toBe(4);
			expect(parsed.game_type).toBe(original.game_type);
			expect(parsed.player_num).toBe(original.player_num);
			expect(parsed.gameid).toBe(original.gameid);
			expect(parsed.ctime).toBe(original.ctime);
			expect(parsed.lines).toBe(original.lines);
			expect(parsed.level).toBe(original.level);
			expect(parsed.score).toBe(original.score);
			expect(parsed.instant_das).toBe(original.instant_das);
			expect(parsed.preview).toBe(original.preview);
			expect(parsed.cur_piece_das).toBe(original.cur_piece_das);
			expect(parsed.cur_piece).toBe(original.cur_piece);

			// Piece distributions
			expect(parsed.T).toBe(original.T);
			expect(parsed.J).toBe(original.J);
			expect(parsed.Z).toBe(original.Z);
			expect(parsed.O).toBe(original.O);
			expect(parsed.S).toBe(original.S);
			expect(parsed.L).toBe(original.L);
			expect(parsed.I).toBe(original.I);

			// Compare arrays via jest deep equality
			expect(parsed.field).toEqual(original.field);
		});

		it('should correctly round-trip a minimal frame for version 4', () => {
			const original = {
				game_type: BinaryFrame.GAME_TYPE.MINIMAL,
				player_num: 31,
				gameid: 12345,
				ctime: Math.floor(Date.now() / 1000) & 0xfffffff,
				lines: 2 ** 13 - 2,
				level: 2 ** 8 - 2,
				score: 2 ** 26 - 2,
				instant_das: 16,
				preview: 'T',
				field: Array.from({ length: 200 }, (_, i) => i % 3),
			};

			const buffer = BinaryFrame.encode(original);

			// Version 4 minimal size is 64
			expect(buffer.length).toBe(64);

			const parsed = BinaryFrame.parse(buffer);

			expect(parsed.version).toBe(4);
			expect(parsed.game_type).toBe(original.game_type);
			expect(parsed.player_num).toBe(original.player_num);
			expect(parsed.gameid).toBe(original.gameid);
			expect(parsed.ctime).toBe(original.ctime);
			expect(parsed.lines).toBe(original.lines);
			expect(parsed.level).toBe(original.level);
			expect(parsed.score).toBe(original.score);
			expect(parsed.instant_das).toBe(original.instant_das);
			expect(parsed.preview).toBe(original.preview);

			// Not encoded fields should be undefined
			expect(parsed.cur_piece_das).toBeUndefined();
			expect(parsed.cur_piece).toBeUndefined();
			expect(parsed.T).toBeUndefined();
			expect(parsed.J).toBeUndefined();
			expect(parsed.Z).toBeUndefined();
			expect(parsed.O).toBeUndefined();
			expect(parsed.S).toBeUndefined();
			expect(parsed.L).toBeUndefined();
			expect(parsed.I).toBeUndefined();

			expect(parsed.field).toEqual(original.field);
		});

		it('should correctly round-trip a das trainer frame for version 4', () => {
			const original = {
				game_type: BinaryFrame.GAME_TYPE.DAS_TRAINER,
				player_num: 31,
				gameid: 12345,
				ctime: Math.floor(Date.now() / 1000) & 0xfffffff,
				lines: 2 ** 13 - 2,
				level: 2 ** 8 - 2,
				score: 2 ** 26 - 2,
				instant_das: 16,
				preview: 'T',
				cur_piece_das: 16,
				cur_piece: 'J',
				field: Array.from({ length: 200 }, (_, i) => i % 3),
			};

			const buffer = BinaryFrame.encode(original);

			// Version 4 das trainer size is 65
			expect(buffer.length).toBe(65);

			const parsed = BinaryFrame.parse(buffer);

			expect(parsed.version).toBe(4);
			expect(parsed.game_type).toBe(original.game_type);
			expect(parsed.player_num).toBe(original.player_num);
			expect(parsed.gameid).toBe(original.gameid);
			expect(parsed.ctime).toBe(original.ctime);
			expect(parsed.lines).toBe(original.lines);
			expect(parsed.level).toBe(original.level);
			expect(parsed.score).toBe(original.score);
			expect(parsed.instant_das).toBe(original.instant_das);
			expect(parsed.preview).toBe(original.preview);
			expect(parsed.cur_piece_das).toBe(original.cur_piece_das);
			expect(parsed.cur_piece).toBe(original.cur_piece);

			// Piece distributions should be undefined
			expect(parsed.T).toBeUndefined();
			expect(parsed.J).toBeUndefined();
			expect(parsed.Z).toBeUndefined();
			expect(parsed.O).toBeUndefined();
			expect(parsed.S).toBeUndefined();
			expect(parsed.L).toBeUndefined();
			expect(parsed.I).toBeUndefined();

			expect(parsed.field).toEqual(original.field);
		});

		it('should handle nullable fields correctly', () => {
			const originalWithNulls = {
				game_type: BinaryFrame.GAME_TYPE.CLASSIC,
				player_num: 0,
				gameid: 54321,
				ctime: 1234567,
				lines: null,
				level: null,
				score: null,
				instant_das: null,
				preview: null,
				cur_piece_das: null,
				cur_piece: null,
				T: null,
				J: null,
				Z: null,
				O: null,
				S: null,
				L: null,
				I: null,
				field: Array(200).fill(0),
			};

			const buffer = BinaryFrame.encode(originalWithNulls);
			const parsed = BinaryFrame.parse(buffer);

			expect(parsed.score).toBeNull();
			expect(parsed.lines).toBeNull();
			expect(parsed.level).toBeNull();
			expect(parsed.instant_das).toBeNull();
			expect(parsed.preview).toBeNull();
			expect(parsed.cur_piece_das).toBeNull();
			expect(parsed.cur_piece).toBeNull();
			expect(parsed.T).toBeNull();
			expect(parsed.J).toBeNull();
			expect(parsed.Z).toBeNull();
			expect(parsed.O).toBeNull();
			expect(parsed.S).toBeNull();
			expect(parsed.L).toBeNull();
			expect(parsed.I).toBeNull();
		});

		it('should extract ctime without parsing the whole structure', () => {
			const ctime = 9876543;
			const original = {
				game_type: BinaryFrame.GAME_TYPE.CLASSIC,
				gameid: 1111,
				ctime, // test target
				lines: 10,
				level: 1,
				score: 1000,
				instant_das: 1,
				preview: 'Z',
				cur_piece_das: 1,
				cur_piece: 'O',
				T: 1,
				J: 1,
				Z: 1,
				O: 1,
				S: 1,
				L: 1,
				I: 1,
				field: Array(200).fill(0),
			};

			const buffer = BinaryFrame.encode(original);

			// extract ctime directly from the static method
			const extractedCTime = BinaryFrame.getCTime(buffer);

			expect(extractedCTime).toBe(ctime);
		});

		it('should throw an error for unsupported format versions', () => {
			const buffer = new Uint8Array(200);
			// fake version 7 (0b111 << 5)
			buffer[0] = 7 << 5;

			expect(() => {
				BinaryFrame.parse(buffer);
			}).toThrow(/Invalid Frame: Version not supported/);
		});

		it('should throw an error for buffers that are too long', () => {
			// Version 3 max is 73. So let's make it 80
			const buffer = new Uint8Array(80);
			// set valid version 3
			buffer[0] = 3 << 5;

			expect(() => {
				BinaryFrame.parse(buffer);
			}).toThrow(/Invalid frame: too long/);
		});

		it('should throw an error for buffers that are too short', () => {
			// POSSBLE_RIGHT_PADDING is 51, so 73 - 51 = 22.
			// 10 is shorter than the minimum threshold.
			const buffer = new Uint8Array(10);
			// set valid version 3
			buffer[0] = 3 << 5;

			expect(() => {
				BinaryFrame.parse(buffer);
			}).toThrow(/Invalid frame: too short/);
		});

		it('should pad short buffers if they fall within right padding threshold', () => {
			// 73 - 50 = 23 length buffer
			const buffer = new Uint8Array(23);
			buffer[0] = 3 << 5; // v3

			// We won't test full equality here because the rest of the buffer is 0s
			// but we want to make sure it doesn't throw and correctly pads it to 73 internally
			const parsed = BinaryFrame.parse(buffer);

			expect(parsed.version).toBe(3);
			// All fields should be 0 (the default missing array values)
			expect(parsed.field.every(val => val === 0)).toBe(true);
		});

		it('should correctly decode a version 1 frame', () => {
			const v1Buffer = new Uint8Array([
				42, 48, 57, 255, 255, 255, 244, 50, 56, 25, 18, 96, 65, 15, 12, 10, 22,
				25, 18, 33, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97,
				134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134,
				24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97,
				134, 24, 97, 0,
			]);
			const parsed = BinaryFrame.parse(v1Buffer);
			expect(parsed.version).toBe(1);
			expect(parsed.game_type).toBe(1);
			expect(parsed.player_num).toBe(2);
			expect(parsed.gameid).toBe(12345);
			expect(parsed.ctime).toBe(268435455);
			expect(parsed.lines).toBe(100);
			expect(parsed.level).toBe(18);
			expect(parsed.score).toBe(550000);
			expect(parsed.instant_das).toBe(12);
			expect(parsed.preview).toBe('T');
			expect(parsed.cur_piece_das).toBe(8);
			expect(parsed.cur_piece).toBe('J');
			expect(parsed.T).toBe(15);
			expect(parsed.J).toBe(12);
			expect(parsed.Z).toBe(10);
			expect(parsed.O).toBe(22);
			expect(parsed.S).toBe(25);
			expect(parsed.L).toBe(18);
			expect(parsed.I).toBe(33);
			expect(parsed.field).toEqual([
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1,
			]);
		});

		it('should correctly decode a version 2 frame', () => {
			const v2Buffer = new Uint8Array([
				74, 48, 57, 255, 255, 255, 240, 100, 18, 8, 100, 112, 96, 65, 7, 131, 1,
				65, 96, 200, 72, 66, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134,
				24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97,
				134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134,
				24, 97, 134, 24, 97,
			]);
			const parsed = BinaryFrame.parse(v2Buffer);
			expect(parsed.version).toBe(2);
			expect(parsed.game_type).toBe(1);
			expect(parsed.player_num).toBe(2);
			expect(parsed.gameid).toBe(12345);
			expect(parsed.ctime).toBe(268435455);
			expect(parsed.lines).toBe(100);
			expect(parsed.level).toBe(18);
			expect(parsed.score).toBe(550000);
			expect(parsed.instant_das).toBe(12);
			expect(parsed.preview).toBe('T');
			expect(parsed.cur_piece_das).toBe(8);
			expect(parsed.cur_piece).toBe('J');
			expect(parsed.T).toBe(15);
			expect(parsed.J).toBe(12);
			expect(parsed.Z).toBe(10);
			expect(parsed.O).toBe(22);
			expect(parsed.S).toBe(25);
			expect(parsed.L).toBe(18);
			expect(parsed.I).toBe(33);
			expect(parsed.field).toEqual([
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1,
			]);
		});

		it('should correctly decode a version 3 frame', () => {
			const v3Buffer = new Uint8Array([
				106, 48, 57, 255, 255, 255, 240, 100, 18, 8, 100, 112, 96, 65, 3, 192,
				192, 40, 22, 6, 65, 32, 132, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24,
				97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97,
				134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134, 24, 97, 134,
				24, 97, 134, 24, 97, 134, 24, 97,
			]);
			const parsed = BinaryFrame.parse(v3Buffer);
			expect(parsed.version).toBe(3);
			expect(parsed.game_type).toBe(1);
			expect(parsed.player_num).toBe(2);
			expect(parsed.gameid).toBe(12345);
			expect(parsed.ctime).toBe(268435455);
			expect(parsed.lines).toBe(100);
			expect(parsed.level).toBe(18);
			expect(parsed.score).toBe(550000);
			expect(parsed.instant_das).toBe(12);
			expect(parsed.preview).toBe('T');
			expect(parsed.cur_piece_das).toBe(8);
			expect(parsed.cur_piece).toBe('J');
			expect(parsed.T).toBe(15);
			expect(parsed.J).toBe(12);
			expect(parsed.Z).toBe(10);
			expect(parsed.O).toBe(22);
			expect(parsed.S).toBe(25);
			expect(parsed.L).toBe(18);
			expect(parsed.I).toBe(33);
			expect(parsed.field).toEqual([
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2,
				0, 1, 2, 0, 1, 2, 0, 1,
			]);
		});
	});
});
