import _ from 'lodash';
import Room from './Room.js';

const PRODUCER_FIELDS = ['id', 'login', 'display_name', 'profile_image_url'];
const MAX_PLAYERS = 8;

function getBasePlayerData() {
	return {
		id: '',
		login: '',
		display_name: '',
		profile_image_url: '',
		victories: 0,
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
			bestof: 3,
			concurrent_2_matches: undefined, // undefined|true|false
			selected_match: null, // 0|1|null
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
		console.log('addProducer', user.id);
		const is_new_user = !this.hasProducer(user);

		if (is_new_user) {
			this.producers.add(user);
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

	removeProducer(user, is_replace_flow = false) {
		const was_present = this.hasProducer(user);

		if (was_present) {
			this.producers.delete(user);

			if (!is_replace_flow) {
				this.sendStateToAdmin();
			}
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

			if (this.state.concurrent_2_matches === view_meta.concurrent_2_matches) {
				if (this.state.concurrent_2_matches) {
					connection.send(['setMatch', this.state.selected_match]);
				}
			} else {
				this.state.concurrent_2_matches = view_meta.concurrent_2_matches;
				this.state.selected_match = undefined;

				if (this.state.concurrent_2_matches) {
					connection.send(['setMatch', this.state.selected_match]);
				}

				this.sendStateToAdmin();
			}
		}

		// do a room state dump for this new view
		connection.send(['setBestOf', this.state.bestof]);

		this.state.players.forEach((player, pidx) => {
			connection.send(['setId', pidx, player.id]);
			connection.send(['setLogin', pidx, player.login]);
			connection.send(['setDisplayName', pidx, player.display_name]);
			connection.send(['setProfileImageURL', pidx, player.profile_image_url]);
			connection.send(['setVictories', pidx, player.victories]);

			if (player.id) {
				const user = this.getProducer(player.id);

				connection.send(['setPeerId', pidx, user.getProducer().getPeerId()]);
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

	onAdminMessage(message) {
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
					const [p_num, p_id] = args;
					console.log('setPlayer()', p_id, typeof p_id);

					let player_data;
					let player_id = `${p_id}`;

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

					this.state.players[p_num] = {
						...this.state.players[p_num],
						...player_data,
						victories: 0,
					};

					const peerid = user ? user.getProducer().getPeerId() : '';

					// Send data to all views
					this.sendToViews(['setId', p_num, player_data.id]);
					this.sendToViews(['setPeerId', p_num, peerid]);
					this.sendToViews(['setLogin', p_num, player_data.login]);
					this.sendToViews(['setDisplayName', p_num, player_data.display_name]);
					this.sendToViews([
						'setProfileImageURL',
						p_num,
						player_data.profile_image_url,
					]);

					// inform producer it is a now a player
					if (user) {
						user.getProducer().send(['makePlayer', p_num, this.getViewMeta()]);
					}

					forward_to_views = false;
					break;
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

				case 'setWinner':
				case 'setGameOver':
				case 'cancelGameOver': {
					update_admin = false;
					break;
				}

				case 'addPlayer': {
					if (this.state.players.length < MAX_PLAYERS) {
						const player = getBasePlayerData();
						const pidx = this.state.players.length;

						this.state.players.push(player);

						this.sendToViews(['setId', pidx, player.id]);
						this.sendToViews(['setLogin', pidx, player.login]);
						this.sendToViews(['setDisplayName', pidx, player.display_name]);
						this.sendToViews([
							'setProfileImageURL',
							pidx,
							player.profile_image_url,
						]);
						this.sendToViews(['setVictories', pidx, player.victories]);
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
					} catch (err) {
						// ignore errors
					}

					const updatePlayer = (player, pidx) => {
						// TODO: this should also also set the player idx
						this.sendToViews(['setId', pidx, player.id]);
						this.sendToViews(['setLogin', pidx, player.login]);
						this.sendToViews(['setDisplayName', pidx, player.display_name]);
						this.sendToViews([
							'setProfileImageURL',
							pidx,
							player.profile_image_url,
						]);
						this.sendToViews(['setVictories', pidx, player.victories]);

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
						const player = this.state.players[pidx];

						updatePlayer(player, pidx);
					}

					// finally send dummy data to clear last player
					// warning: this clears the player data, but it doens't cler the player object itself :(
					// TODO: implement an actual removePlayer() API in views
					updatePlayer(getBasePlayerData(), this.state.players.length);

					forward_to_views = false;
					break;
				}

				case 'setMatch': {
					this.state.selected_match = args[0];
					update_admin = false;
					break; // simple passthrough
				}

				case 'showProfileCard': {
					update_admin = false;
					break; // simple passthrough
				}

				default: {
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
		this.state.players.forEach((player, p_num) => {
			if (player.id === user.id) {
				if (message instanceof Uint8Array) {
					message[0] = (message[0] & 0b11111000) | p_num; // sets player number in header byte of binary message
					this.sendToViews(message);
				} else {
					this.sendToViews(['frame', p_num, message]);
				}
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
