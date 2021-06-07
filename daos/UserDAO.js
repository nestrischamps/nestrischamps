const User = require('../domains/User');
const dbPool = require('../modules/db');

class UserDAO {
	users_by_id = new Map();
	users_by_login = new Map();
	users_by_secret = new Map();

	addUserFromData(user_data) {
		const user = new User(user_data);

		user.on('expired', () => {
			this.removeUser(user);
		});

		this.addUser(user);

		return user;
	}

	addUser(user) {
		this.users_by_id.set(user.id, user);
		this.users_by_login.set(user.login, user);
		this.users_by_secret.set(user.secret, user);
	}

	removeUser(user) {
		this.users_by_id.delete(user.id);
		this.users_by_login.delete(user.login);
		this.users_by_secret.delete(user.secret);
	}

	async createUser(user_data) {
		await dbPool.query(
			`INSERT INTO twitch_users
			(id, login, email, secret, type, description, display_name, profile_image_url, created_on, last_login)
			VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
			ON CONFLICT(id)
			DO UPDATE SET login=$2, email=$3, type=$5, description=$6, display_name=$7, profile_image_url=$8, last_login=NOW();
			`,
			[
				user_data.id,
				user_data.login,
				user_data.email,
				user_data.secret,
				user_data.type,
				user_data.description,
				user_data.display_name,
				user_data.profile_image_url,
			]
		);

		// we force fetch to:
		// 1) get the correct data shape
		// 2) ensure we get the latest secret
		return this.getUserById(user_data.id);
	}

	async deleteUser(user) {
		this.removeUser(user);

		await dbPool.query('DELETE FROM twitch_users WHERE id=$1;', [user.id]);
	}

	async updateSecret(user, new_secret) {
		// WARNING: potential re-entrancy problem with this method
		// WARNING: deal with it later

		try {
			// then update DB ... dubious order, the whole thing should be a transaction
			await dbPool.query(
				`UPDATE twitch_users
				set secret=$1
				WHERE id=$2
				`,
				[new_secret, user.id]
			);

			// TODO: add greater processing safety here
			this.users_by_secret.delete(user.secret);
			user.secret = new_secret;
			this.users_by_secret.set(user.secret, user);
		} catch (err) {
			console.log(`Unable to update secret for user ${user.login}`);
		}

		return user;
	}

	async getUserById(id, force_fetch = false) {
		let user = this.users_by_id.get(id);

		if (!user || force_fetch) {
			const result = await dbPool.query(
				'SELECT * FROM twitch_users WHERE id=$1',
				[id]
			);

			if (result.rows.length) {
				user = this.addUserFromData(result.rows[0]);
			}
		}

		return user;
	}

	async getUserByLogin(login) {
		let user = this.users_by_login.get(login);

		if (!user) {
			const result = await dbPool.query(
				'SELECT * FROM twitch_users WHERE login=$1',
				[login]
			);

			if (result.rows.length) {
				user = this.addUserFromData(result.rows[0]);
			}
		}

		return user;
	}

	async getUserBySecret(secret) {
		let user = this.users_by_secret.get(secret);

		if (!user) {
			const result = await dbPool.query(
				'SELECT * FROM twitch_users WHERE secret=$1',
				[secret]
			);

			if (result.rows.length) {
				user = this.addUserFromData(result.rows[0]);
			}
		}

		return user;
	}
}

module.exports = new UserDAO();
