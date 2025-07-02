import _ from 'lodash';
import UserDAO from '../daos/UserDAO.js';
import Room from './Room.js';

const PRODUCER_FIELDS = [
	'id',
	'login',
	'display_name',
	'profile_image_url',
	'country_code',
	'vdo_ninja_url',
];
const MAX_PLAYERS = 8;

function getBasePlayerData() {
	return {
		id: '',
		login: '',
		display_name: '',
		country_code: '',
		profile_image_url: '',
		vdo_ninja_url: '',
		victories: 0,
		camera: {
			mirror: 0, // horizontal mirror only (for now)
			// can potentially add more here in term of xshift, yshift, zoomin, zoomout, etc...
		},
	};
}

class MatchRoom extends Room {
	constructor(owner, roomid) {
		super(owner);

		this.producers = new Set(); // users
		this.admin = null;
		this.roomid = roomid || '_default';
		this.last_view = null;
		this.state = {
			bestof: 5,
			concurrent_2_matches: undefined, // undefined|true|false
			selected_match: null, // 0|1|null
			curtain_logo: null, // url to image or null
			autojoin: false,
			players: [
				// flat user objects - starts with 2 players
				getBasePlayerData(),
				getBasePlayerData(),
			],
		};

		this.onAdminMessage = this.onAdminMessage.bind(this);
	}

	setAdmin(connection) {
		// Only owner can be admin
		if (connection.user.id != this.owner.id) {
			connection.kick('forbidden');
			return;
		}

		if (this.admin) {
			this.admin.kick('concurrency_limit');
		}
		this.admin = connection;

		connection.on('message', this.onAdminMessage);
		connection.once('close', () => {
			if (this.admin == connection) {
				// only overwrite self (for potential race conditions)
				this.admin = null;
			}
		});

		this.admin.send([
			'setOwner',
			{
				id: this.owner.id,
				login: this.owner.login,
			},
		]);
		this.sendStateToAdmin();
	}

	getProducerFields(user) {
		return _.pick(user, PRODUCER_FIELDS);
	}

	hasProducer(user) {
		return this.producers.has(user);
	}

	addProducer(user) {
		console.log('addProducer', user.id, typeof user.id);
		const is_new_user = !this.hasProducer(user);

		if (is_new_user) {
			this.producers.add(user);

			if (this.state.autojoin) {
				this.autoJoinUser(user);
			}

			this.sendStateToAdmin();
		}

		// whether or not the user was new, its peer id changed
		// so we need to inform the view
		if (this.last_view) {
			user.getProducer().send(['setViewPeerId', this.last_view.id]);

			this.state.players.forEach((player, pidx) => {
				if (player.id !== user.id) return;

				this.last_view.send([
					'setPeerId',
					pidx,
					user.getProducer().getPeerId(),
				]);
				user.getProducer().send(['makePlayer', pidx, this.getViewMeta()]);
			});
		}
	}

	getProducer(user_id) {
		const iter = this.producers.values();
		let next;

		while ((next = iter.next())) {
			const user = next.value;

			if (!user) return;

			if (user.id === user_id) {
				return user;
			}
		}
	}

	getPlayer(user_id) {
		const data = this.state.players.find(player => player.id === user_id);

		if (data) {
			return this.getProducer(user_id);
		}
	}

	removeProducer(user) {
		const was_present =
			this.hasProducer(user) ||
			this.state.players.some(player => player.id === user.id);

		if (was_present) {
			// drop the producer
			this.producers.delete(user);

			// remove all players associated to that producer
			let removed_players = 0;
			this.state.players.forEach((player, p_idx) => {
				if (player.id === user.id) {
					removed_players++;
					this.setPlayer(p_idx, null);
				}
			});

			if (removed_players && this.state.autojoin) {
				this.doAutoJoin();
			}

			this.sendStateToAdmin();
		}

		// TODO: anything to send to the views?
	}

	addView(connection, is_secret_view = true) {
		super.addView(connection);

		if (is_secret_view) {
			if (this.last_view) {
				this.last_view.send(['setSecondaryView']);
			}

			this.last_view = connection;

			this.producers.forEach(user => {
				user.getProducer().send(['setViewPeerId', this.last_view.id]);
			});

			const view_meta = this.getViewMeta();

			// type cast known view meta data
			if ('_concurrent_2_matches' in view_meta) {
				view_meta._concurrent_2_matches =
					view_meta._concurrent_2_matches === 'true';
			}
			if ('_players' in view_meta) {
				view_meta._players = parseInt(view_meta._players, 10);
			}

			if (this.state.concurrent_2_matches !== view_meta._concurrent_2_matches) {
				this.state.concurrent_2_matches = view_meta._concurrent_2_matches;
				this.state.selected_match = null;
				this.sendStateToAdmin();
			}
		}

		if (this.state.concurrent_2_matches) {
			connection.send(['setMatch', this.state.selected_match]);
		}

		// do a room state dump for this new view
		connection.send(['setBestOf', this.state.bestof]);
		connection.send(['setCurtainLogo', this.state.curtain_logo]);

		this.state.players.forEach((player, pidx) => {
			connection.send(['setId', pidx, player.id]);
			connection.send(['setLogin', pidx, player.login]);
			connection.send(['setDisplayName', pidx, player.display_name]);
			connection.send(['setCountryCode', pidx, player.country_code]);
			connection.send(['setProfileImageURL', pidx, player.profile_image_url]);
			connection.send(['setVictories', pidx, player.victories]);
			connection.send(['setVdoNinjaURL', pidx, player.vdo_ninja_url]);

			if (player.id) {
				const user = this.getProducer(player.id);

				if (!user) return; // how is this happening? 🤔😞

				connection.send(['setPeerId', pidx, user.getProducer().getPeerId()]);

				if (!is_secret_view) return;

				user.getProducer().send(['makePlayer', pidx, this.getViewMeta()]); // could be too fast for call to work ??
			}
		});
	}

	removeView(connection) {
		super.removeView(connection);

		if (connection === this.last_view) {
			this.last_view = null;

			this.producers.forEach(user => {
				user.getProducer().send(['setViewPeerId', null]);
			});
		}
	}

	getViewMeta() {
		if (!this.last_view) return {};

		return this.last_view.meta;
	}

	// get state of the room:
	// list all connected producers
	// get current best of N count
	// list current victory point
	// list customization on avatars and names
	getState() {
		return {
			producers: [...this.producers].map(this.getProducerFields),
			...this.state,
		};
	}

	sendStateToAdmin() {
		this.tellAdmin(['state', this.getState()]);
	}

	tellAdmin(message) {
		if (!this.admin) return;

		this.admin.send(message);
	}

	assertValidPlayer(p_num) {
		if (
			typeof p_num === 'number' &&
			p_num >= 0 &&
			p_num < MAX_PLAYERS &&
			!(p_num % 1)
		) {
			return true;
		}

		throw new RangeError(`Player number is invalid (${p_num})`);
	}

	getPlayerData(player_id) {
		return this.state.players.find(player => player.id === player_id);
	}

	getMaxPossiblePlayers() {
		return Math.min(this.getViewMeta()._players || Infinity, MAX_PLAYERS);
	}

	doAutoJoin() {
		// 1. sort all producers not currently assigned
		const player_user_ids = new Set(
			this.state.players.map(player => player.id)
		);
		const unassigned_producers = [...this.producers]
			.filter(user => !player_user_ids.has(user.id))
			.sort(
				(u1, u2) => u1.match_room_join_ts - u2.match_room_join_ts // breaks encapsulation -_-
			);

		// 2. assign as many of the "dangling" producers as possible
		// not the most computationally efficient way to do it, but nicely readable
		let did_assign = false;
		for (const user of unassigned_producers) {
			did_assign ||= this.autoJoinUser(user);
		}

		return did_assign;
	}

	autoJoinUser(user) {
		for (let idx = 0; idx < this.getMaxPossiblePlayers(); idx++) {
			if (!this.state.players[idx]?.id) {
				this.setPlayer(idx, user.id);
				return true;
			}
		}

		return false;
	}

	setPlayer(p_num, p_id) {
		console.log('setPlayer()', p_id, typeof p_id);

		let player_data;
		const player_id = `${p_id}`;

		this.assertValidPlayer(p_num);

		const old_player_id = this.state.players[p_num].id;

		if (old_player_id && player_id != old_player_id) {
			// player at p_num is being replaced
			// check if old player was used in more than one slot
			// if not, then user needs to be informed it is dropped as a player
			const still_around =
				this.state.players.filter(player => player.id === old_player_id)
					.length > 1;

			if (!still_around) {
				const user = this.getProducer(this.state.players[p_num].id);

				if (user) {
					// hmm, is this necessary?
					user.getProducer().send(['dropPlayer']);
				}
			}
		}

		const user = this.getProducer(player_id);

		if (!p_id) {
			// player is being erased, get a fresh data set
			player_data = getBasePlayerData();
		} else {
			player_data = this.getPlayerData(player_id);

			if (!player_data && user) {
				player_data = this.getProducerFields(user);
			}
		}

		if (!player_data) {
			console.log(`Room ${this.roomid}: Player not found`);
			return;
		}

		this.state.players[p_num] = _.cloneDeep({
			...this.state.players[p_num],
			...player_data,
			victories: 0,
		});

		const peerid = user ? user.getProducer().getPeerId() : '';

		// Send data to all views
		this.sendPlayerInfoToViews(p_num);

		// Do this after the main info so peerid doesn't get nuked
		// TODO: only send to main view
		this.sendToViews(['setPeerId', p_num, peerid]);

		// inform producer it is a now a player to restart the video
		if (user) {
			user.getProducer().send(['makePlayer', p_num, this.getViewMeta()]);
		}
	}

	async setPlayerOnBehalfOfUser(p_num, p_id) {
		console.log('setPlayerOnBehalfOfUser()', p_num, p_id, typeof p_id);

		this.assertValidPlayer(p_num);

		const user_id = `${p_id}`;

		if (!/^[1-9]\d*$/.test(user_id)) return;

		const player = this.state.players[p_num];
		const player_data = await UserDAO.getUserById(player.id);
		const user_data = await UserDAO.getUserById(user_id, true);

		Object.assign(player, {
			login: user_data.login,
			display_name: user_data.display_name,
			country_code: user_data.country_code,
			on_behalf_of_user: user_id,
		});

		// warning: this adds state to the global player object. As in, it reaches out of the matchroom and into the whole process
		// it's dirty but sort of fine to do, since a user can only have a single producer at a time
		player_data.on_behalf_of_user = {
			id: user_id,
			display_name: user_data.display_name,
		};

		this.sendToViews(['setLogin', p_num, user_data.login]);
		this.sendToViews(['setDisplayName', p_num, user_data.display_name]);
		this.sendToViews(['setCountryCode', p_num, user_data.country_code]);

		// only update the avatar if supplied
		if (!/^\s*$/.test(user_data.profile_image_url)) {
			this.state.players[p_num].profile_image_url = user_data.profile_image_url;

			this.sendToViews([
				'setProfileImageURL',
				p_num,
				user_data.profile_image_url,
			]);
		}
	}

	sendPlayerInfoToViews(pidx, data = null) {
		const player = data || this.state.players[pidx];

		this.sendToViews(['setId', pidx, player.id]); // resets the player and game in frontend
		this.sendToViews(['setLogin', pidx, player.login]);
		this.sendToViews(['setDisplayName', pidx, player.display_name]);
		this.sendToViews(['setCountryCode', pidx, player.country_code]);
		this.sendToViews(['setProfileImageURL', pidx, player.profile_image_url]);
		this.sendToViews(['setVictories', pidx, player.victories]);
		this.sendToViews(['setVdoNinjaURL', pidx, player.vdo_ninja_url]);
	}

	async onAdminMessage(message) {
		const [command, ...args] = message;
		let forward_to_views = true;
		let update_admin = true;

		// TODO: Extract this encompassing try..catch to own method
		try {
			switch (command) {
				case 'getState': {
					forward_to_views = false;
					break;
				}

				case 'setPlayer': {
					forward_to_views = false;
					this.setPlayer(...args);
					break;
				}

				case 'setPlayerOnBehalfOfUser': {
					forward_to_views = false;
					await this.setPlayerOnBehalfOfUser(...args);
					break;
				}

				case 'restartCamera': {
					update_admin = false;
					forward_to_views = false;

					const [p_num] = args;

					this.assertValidPlayer(p_num);

					const player_id = this.state.players[p_num].id;
					const user = this.getProducer(player_id);

					if (user && this.last_view) {
						const producer = user.getProducer();

						producer.send(['dropPlayer']);
						producer.send(['setViewPeerId', this.last_view.id]);
						producer.send(['makePlayer', p_num, this.getViewMeta()]); // should reset camera!
					}

					break;
				}

				case 'mirrorCamera': {
					update_admin = false;
					forward_to_views = false;

					const [p_num] = args;

					this.assertValidPlayer(p_num);

					const camera_state = this.state.players[p_num].camera;

					// 0 not mirrored - 1 mirrored
					camera_state.mirror += 1;
					camera_state.mirror %= 2;

					this.sendToViews(['setCameraState', p_num, camera_state]);

					break; // simple passthrough
				}

				case 'setDisplayName': {
					const [p_num, name] = args;

					this.assertValidPlayer(p_num);

					this.state.players[p_num].display_name = name;

					break;
				}

				case 'setProfileImageURL': {
					const [p_num, url] = args;

					this.assertValidPlayer(p_num);

					this.state.players[p_num].profile_image_url = url;

					break;
				}

				case 'setCountryCode': {
					const [p_num, country_code] = args;

					this.assertValidPlayer(p_num);

					this.state.players[p_num].country_code = country_code;

					break;
				}

				case 'resetVictories': {
					this.state.players.forEach(player => (player.victories = 0));
					break;
				}

				case 'setVictories': {
					const [p_num, url] = args;

					this.assertValidPlayer(p_num);

					this.state.players[p_num].victories = url;

					break;
				}

				case 'setBestOf': {
					this.state.bestof = args[0];

					break;
				}

				case 'setCurtainLogo': {
					this.state.curtain_logo = args[0];

					break;
				}

				case 'showRunways':
				case 'hideRunways':
				case 'showProfileCard':
				case 'setWinner':
				case 'setGameOver':
				case 'cancelGameOver':
				case 'focusPlayer':
				case 'setHideProfileCardOnNextGame':
				case 'startCountDown':
				case 'clearFieldOverlays': {
					update_admin = false;
					break; // simple passthrough
				}

				case 'addPlayer': {
					if (this.state.players.length < MAX_PLAYERS) {
						const player = getBasePlayerData();
						const pidx = this.state.players.length;
						this.state.players.push(player);
						this.sendPlayerInfoToViews(pidx);
					}
					forward_to_views = false;
					break;
				}

				case 'removePlayer': {
					const p_num = args[0];

					this.assertValidPlayer(p_num);

					const dropped_player = this.state.players.splice(p_num, 1)[0];

					// tell player who is being removed he/she's being dropped
					try {
						this.getProducer(dropped_player.id)
							.getProducer()
							.send(['dropPlayer']);
					} catch (_err) {
						// ignore errors
					}

					const updatePlayer = pidx => {
						const player = this.state.players[pidx];

						this.sendPlayerInfoToViews(pidx);

						// TODO: this should also also set the player idx
						if (this.last_view) {
							const user = player.id ? this.getProducer(player.id) : null;

							if (user) {
								this.last_view.send([
									'setPeerId',
									pidx,
									user.getProducer().getPeerId(),
								]);

								user
									.getProducer()
									.send(['makePlayer', pidx, this.getViewMeta()]);
							} else {
								this.last_view.send(['setPeerId', pidx, '']);
							}
						}
					};

					// update all shifted players
					for (let pidx = p_num; pidx < this.state.players.length; pidx++) {
						updatePlayer(pidx);
					}

					// finally send dummy data to clear last player
					// warning: this clears the player data, but it doens't cler the player object itself :(
					// TODO: implement an actual removePlayer() API in views
					this.sendPlayerInfoToViews(
						this.state.players.length,
						getBasePlayerData()
					);

					forward_to_views = false;
					break;
				}

				case 'setMatch': {
					this.state.selected_match = args[0];
					update_admin = false;
					break; // simple passthrough
				}

				case 'allowAutoJoin': {
					forward_to_views = false;
					const new_autojoin = !!args[0];

					if (new_autojoin && !this.state.autojoin) {
						this.doAutoJoin();
					}

					this.state.autojoin = new_autojoin;

					break;
				}

				default: {
					console.warn(`Received unknown commands ${command}`);
					// reject any unknown command
					return;
				}
			}

			if (forward_to_views) {
				this.sendToViews(message);
			}

			// update admins with latest state
			if (update_admin) {
				this.sendStateToAdmin();
			}
		} catch (err) {
			console.error(err);
		}
	}

	handleProducerMessage(user, message) {
		// system where you can have one user being multiple players
		let send_count = 0;

		if (Array.isArray(message) && message[0] === 'setVdoNinjaURL') {
			user.vdo_ninja_url = message[1];
			this.state.players.forEach((p, p_idx) => {
				if (p.id !== user.id) return;
				p.vdo_ninja_url = user.vdo_ninja_url;
				this.tellAdmin(['setVdoNinjaURL', p_idx, user.vdo_ninja_url]);
			});
		}

		this.state.players.forEach((player, p_idx) => {
			if (player.id !== user.id) return;

			if (message instanceof Uint8Array) {
				if (send_count++ > 0) {
					// sendToViews() ultimately relies on socket.write(), which is not synchronous
					// if the same user is assigned to multiple players in the room, then mutating message will
					// cause duplicate frames when player_num overwrites the value.
					// we make a copy to ensure each player gets its own message
					message = new Uint8Array(message);
				}
				message[0] = (message[0] & 0b11111000) | p_idx; // sets player number in header byte of binary message
				this.sendGameFrameToViews(message);
			} else if (Array.isArray(message)) {
				this.sendToViews([message[0], p_idx, ...message.slice(1)]);
				// TODO: send message to admin page as well?
			} else {
				// assume frame
				this.sendGameFrameToViews(['frame', p_idx, message]);
			}
		});
	}

	close(reason) {
		super.close(reason);

		// dodgy iteration that empties the collection as it goes -_-
		this.producers.forEach(user => {
			this.removeProducer(user);
		});

		this.producers.clear(); // not needed, but added for clarity

		if (this.admin) {
			this.admin.kick(reason);
			this.admin = null;
		}

		if (this.last_view) {
			this.last_view.removeAllListeners();
			this.last_view = null;
		}

		this.emit('close');
	}
}

export default MatchRoom;
