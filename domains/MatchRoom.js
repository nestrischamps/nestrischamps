const _ = require('lodash');

const Room = require('./Room');

const PRODUCER_FIELDS = ['id', 'login', 'display_name', 'profile_image_url'];

class MatchRoom extends Room {
	constructor(owner, roomid) {
		super(owner);

		this.producers = new Set(); // users
		this.admin = null;
		this.roomid = roomid || '_default';
		this.last_view = null;
		this.state = {
			bestof: 3,
			video_feed: 0,
			players: [
				// flat user objects
				{
					id: '',
					login: '',
					display_name: '',
					profile_image_url: '',
					victories: 0,
				},
				{
					id: '',
					login: '',
					display_name: '',
					profile_image_url: '',
					victories: 0,
				},
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
		connection.on('close', () => {
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
			this.state.players.forEach((player, pidx) => {
				if (player.id !== user.id) return;

				this.last_view.send([
					'setPeerId',
					pidx,
					user.getProducer().getPeerId(),
				]);
			});

			// and then inform the producer about the view's peer id
			user.getProducer().send(['setViewPeerId', this.last_view.id]);
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
				this.last_view.removeAllListeners();
			}

			this.last_view = connection;
			this.last_view.on('message', ([cmd, ...args]) => {
				if (cmd === 'acceptPlayersVideoFeed') {
					this.state.video_feed = 1;
				}
			});

			this.producers.forEach(user => {
				user.getProducer().send(['setViewPeerId', this.last_view.id]);
			});
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
				user.getProducer().send(['makePlayer', pidx]); // could be too fast for call to work ??
			}
		});
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
		if (p_num === 0 || p_num === 1) return true;

		throw new RangeError(`Player number is invalid (${p_num})`);
	}

	onAdminMessage(message) {
		const [command, ...args] = message;
		let forward_to_views = true;
		let update_admin = true;

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

					if (
						this.state.players[p_num].id &&
						player_id != this.state.players[p_num].id
					) {
						// replacing player
						const other_player_num = (p_num + 1) % 2;

						if (
							this.state.players[p_num].id !=
							this.state.players[other_player_num].id
						) {
							const user = this.getProducer(this.state.players[p_num].id);

							user.getProducer().send(['dropPlayer']);
						}
					}

					const user = this.getProducer(player_id);

					if (!p_id) {
						player_data = {
							id: '',
							login: '',
							display_name: '',
							profile_image_url: '',
						};
					} else if (this.state.players[0].id === player_id) {
						player_data = this.state.players[0];
					} else if (this.state.players[1].id === player_id) {
						player_data = this.state.players[1];
					} else {
						if (user) {
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
						user.getProducer().send(['makePlayer', p_num]);
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
					this.state.players[0].victories = 0;
					this.state.players[1].victories = 0;

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

				case 'setWinner': {
					update_admin = false;

					break;
				}

				case 'setVideoFeed': {
					this.state.video_feed = args[0] ? 1 : 0;
					break;
				}

				default: {
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
		// system where you can have one user being both players
		[0, 1].forEach(p_num => {
			if (this.state.players[p_num].id === user.id) {
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

module.exports = MatchRoom;
