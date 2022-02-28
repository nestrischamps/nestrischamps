import EventEmitter from 'events';

class Room extends EventEmitter {
	constructor(owner) {
		super();

		this.owner = owner;
		this.views = new Set(); // connections
	}

	getOwner() {
		return this.owner;
	}

	addView(connection) {
		this.views.add(connection);
		connection.once('close', () => this.removeView(connection));
	}

	removeView(connection) {
		return this.views.delete(connection);
	}

	hasViews() {
		return this.views.size > 0;
	}

	sendToViews(message) {
		this.views.forEach(connection => connection.send(message));
	}

	close(reason) {
		this.views.forEach(connection => connection.kick(reason));
		this.views.clear();
	}

	handleProducerMessage(user, message) {
		if (message instanceof Uint8Array) {
			this.sendToViews(message);
		} else if (Array.isArray(message)) {
			this.sendToViews(message);
		} else {
			this.sendToViews(['frame', 0, message]);
		}
	}
}

export default Room;
