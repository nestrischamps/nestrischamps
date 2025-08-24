import middlewares from '../modules/middlewares.js';
import layouts from '../modules/layouts.js';
import UserDAO from '../daos/UserDAO.js';
import Replay from '../domains/Replay.js';
import Connection from '../modules/Connection.js';

function passThrough(cb) {
	cb();
}

export default function init(server, wss) {
	server.on('upgrade', async function (request, socket, head) {
		console.log(`WS: ${request.url}`);

		// nestrischamps URL, parsed
		request.nc_url = new URL(request.url, 'ws://nestrischamps.io');

		let m = request.nc_url.pathname.match(
			/^\/ws\/replay\/([a-z0-9_-]+)\/((\d+)(-(\d+)){0,7})/
		);

		if (m) {
			request.is_replay = true; // indicate no need to have user session
			request.game_ids = m[2].split('-');

			request.speed = 1;

			let speed = request.nc_url.searchParams.get('speed');

			if (speed) {
				if (/^\d+$/.test(speed)) {
					request.speed = parseInt(speed, 10) || 1;
				}
			}

			middlewares.sessionMiddleware(request, {}, async () => {
				wss.handleUpgrade(request, socket, head, function (ws) {
					wss.emit('connection', ws, request);
				});
			});

			return;
		}

		m = request.nc_url.pathname.match(
			/^\/ws\/view\/([a-z0-9_-]+)\/([a-zA-Z0-9-]+)/
		);

		request.is_secret_view = !!m;

		if (request.is_secret_view) {
			if (!request.tetris) {
				request.tetris = {};
			}

			const layout = layouts[m[1]];

			if (!layout) {
				// Why does the websocket cares about the layout?
				// Answer: because it needs to know if the attachment target is private room or match room
				// When connecting over room ids (in the future), that will not matter
				// The room itself will know what type it is
				socket.write('HTTP/1.1 404 Layout not found\r\n\r\n'); // TODO: can this redirect?
				socket.destroy();
				return;
			}

			request.tetris.view = {
				single_player: layout.type == '1p',
				layout_id: m[1],
				user_secret: m[2],
			};

			request.nc_url.searchParams.set('_layout', request.tetris.view.layout_id);

			// connection from the non-session-ed views (from OBS)
			const user = await UserDAO.getUserBySecret(
				request.tetris.view.user_secret
			);

			if (!user) {
				socket.write('HTTP/1.1 404 User Not Found\r\n\r\n'); // TODO: can this redirect?
				socket.destroy();
				return;
			}

			console.log(
				`WS: Retrieved user ${user.login} from view secret`,
				request.tetris.view
			);

			if (!request.session) {
				request.session = { save: passThrough }; // should never enter here
			}

			request.session.user = {
				id: user.id,
				login: user.login,
				secret: user.secret,
				profile_image_url: user.profile_image_url,
			};

			request.session.save(() => {
				wss.handleUpgrade(request, socket, head, function (ws) {
					wss.emit('connection', ws, request);
				});
			});

			return;
		}

		m = request.nc_url.pathname.match(
			/^\/ws\/room\/(u\/([a-z0-9_-]+)\/)?(producer2?|emu)\/([a-zA-Z0-9-]+)/
		);

		request.is_secret_producer = !!m;

		if (request.is_secret_producer) {
			if (!request.tetris) {
				request.tetris = {};
			}

			request.tetris.producer = {
				target_user_login: m[2],
				connecting_user_secret: m[4],
			};

			const connecting_user = await UserDAO.getUserBySecret(
				request.tetris.producer.connecting_user_secret
			);

			if (!connecting_user) {
				socket.write('HTTP/1.1 404 Connecting User Not Found\r\n\r\n');
				socket.destroy();
				return;
			}

			if (request.tetris.producer.target_user_login) {
				const target_user = await UserDAO.getUserByLogin(
					request.tetris.producer.target_user_login
				);

				if (!target_user) {
					socket.write('HTTP/1.1 404 Target User Not Found\r\n\r\n');
					socket.destroy();
					return;
				}
			}

			if (!request.session) {
				request.session = { save: passThrough }; // should never happen
			}

			request.session.user = {
				id: connecting_user.id,
				login: connecting_user.login,
				secret: connecting_user.secret,
				profile_image_url: connecting_user.profile_image_url,
			};

			request.session.save(() => {
				wss.handleUpgrade(request, socket, head, function (ws) {
					wss.emit('connection', ws, request);
				});
			});

			return;
		}

		if (process.env.IS_PUBLIC_SERVER !== '1') {
			m = request.nc_url.pathname.match(/^\/ws\/room\/admin\/([a-zA-Z0-9-]+)/);

			request.is_secret_admin = !!m;

			if (request.is_secret_admin) {
				const connecting_user_secret = m[1];

				const connecting_user = await UserDAO.getUserBySecret(
					connecting_user_secret
				);

				if (!connecting_user) {
					socket.write('HTTP/1.1 404 Connecting User Not Found\r\n\r\n');
					socket.destroy();
					return;
				}

				if (!request.session) {
					request.session = { save: passThrough }; // should never happen
				}

				request.session.user = {
					id: connecting_user.id,
					login: connecting_user.login,
					secret: connecting_user.secret,
					profile_image_url: connecting_user.profile_image_url,
				};

				request.session.save(() => {
					wss.handleUpgrade(request, socket, head, function (ws) {
						wss.emit('connection', ws, request);
					});
				});

				return;
			}
		}

		// all other connections must be within a session!
		// i.e. producers and admin connections

		middlewares.sessionMiddleware(request, {}, async () => {
			if (!request.session || !request.session.user) {
				console.log(`WS: User session not found`);
				socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
				socket.destroy();
				return;
			}

			let m;

			if (
				(m = request.nc_url.pathname.match(/^\/ws\/room\/u\/([a-z0-9_-]+)\//))
			) {
				const target_user = await UserDAO.getUserByLogin(m[1]);

				if (!target_user) {
					console.log(`WS: Target User Not Found`);
					socket.write('HTTP/1.1 404 Target User Not Found\r\n\r\n');
					socket.destroy();
					return;
				}
			}

			console.log(
				`WS: Retrieved user ${request.session.user.login} from session`
			);

			wss.handleUpgrade(request, socket, head, function (ws) {
				console.log('WS: handleUpgrade complete');
				wss.emit('connection', ws, request);
			});
		});
	});

	wss.on('connection', async (ws, request) => {
		if (request.is_replay) {
			const user = (request.session && request.session.user) || { id: 1 };
			const connection = new Connection(user, ws);

			request.game_ids.forEach((game_id, idx) => {
				new Replay(connection, idx, parseInt(game_id, 10), request.speed);
			});

			return;
		}

		console.log(
			'WS: Connection!',
			request.url,
			request.session.user.id,
			request.session.user.login
		);

		const pathname = request.nc_url.pathname;
		const user = await UserDAO.getUserById(request.session.user.id);

		// synchronize session token if needed
		await middlewares.checkToken(request, {});

		const connection = new Connection(user, ws, request.nc_url.searchParams);

		let m; // for url matching (if needed below)

		user.addConnection(connection);

		if (request.is_secret_view) {
			console.log(
				'WS: Adding View',
				user.login,
				'single?',
				request.tetris.view.single_player
			);
			const room = request.tetris.view.single_player
				? user.getPrivateRoom()
				: user.getHostRoom();
			room.addView(connection);
		} else if (request.is_secret_producer) {
			console.log(`Secret Producer for ${user.login}`);
			if (request.tetris.producer.target_user_login) {
				const target_user = await UserDAO.getUserByLogin(
					request.tetris.producer.target_user_login
				);
				user.setProducerConnection(connection, {
					match: true,
					target_user,
				});
			} else {
				user.setProducerConnection(connection, {
					match: false,
					competition: request.nc_url.searchParams.get('competition') === '1',
				});
			}
		} else if (pathname.startsWith('/ws/room/admin')) {
			console.log(`MatchRoom: ${user.login}: Admin connected`);
			user.getHostRoom().setAdmin(connection);
		} else if (/^\/ws\/room\/(producer2?|emu)/.test(pathname)) {
			console.log(`PrivateRoom: ${user.login}: Producer connected`);
			user.setProducerConnection(connection, {
				match: false,
				competition: request.nc_url.searchParams.get('competition') === '1',
			});
		} else if ((m = pathname.match(/^\/ws\/room\/u\/([a-z0-9_-]+)\//))) {
			const target_user = await UserDAO.getUserByLogin(m[1]);

			console.log(
				`Retrieved target user (from ${m[1]}) ${target_user.id} ${target_user.login}`
			);

			if (!target_user) {
				// Should not happen since we check for the target user at the upgtrade step
				// TODO: do at Page or Upgrade level, not at websocket level
				// Although websocket is closest to resolution
				// Page level *could* cause race conditions...
				// Both Page level and Upgrade level could check for target User and throw 404s
				connection.kick('invalid_target');
				return;
			}

			const connection_type = pathname.split('/')[5];

			console.log(`Switching on ${connection_type}`);

			switch (connection_type) {
				/*
				// Ony allow access to admin page of target user's room when a permission system is implemented
				// The target user must have authorized the current user
				case 'admin': {
					console.log(`MatchRoom: ${target_user.login}: Admin connected`);
					target_user.getHostRoom().setAdmin(connection);
					break;
				}
				/** */

				case 'producer2':
				case 'producer':
				case 'emu': {
					console.log(
						`MatchRoom: ${target_user.login}: Producer ${user.login} connected`
					);
					user.setProducerConnection(connection, {
						match: true,
						target_user,
					});
					break;
				}

				case 'view': {
					console.log(
						`MatchRoom: ${target_user.login}: View connected, owned by ${user.login}`
					);
					// TODO: this view should not take over video feed!
					target_user.getHostRoom().addView(connection, false);
					break;
				}

				default: {
					console.log(`WS: Invalid URL`);
					connection.kick('invalid_url');
				}
			}
		} else {
			console.log('Unrecognized connection');
			connection.kick('invalid_url');
		}
	});
}
