import session from 'express-session';
import { v4 as uuidv4 } from 'uuid';
import dbPool from './db.js';
import pgConnect from 'connect-pg-simple';
import UserDAO from '../daos/UserDAO.js';
import config from './config.js';

const pgSession = pgConnect(session);

export default {
	sessionMiddleware: session({
		secret: config.get('server.session_secret') || uuidv4(),
		resave: false,
		saveUninitialized: true,
		cookie: {
			secure: config.get('server.is_public'),
		},
		genid: uuidv4,
		store: new pgSession({
			pool: dbPool,
			tableName: 'sessions',
		}),
		name: 'nsid',
	}),

	assertSession(req, res, next) {
		if (!req.session?.user) {
			req.session.auth_success_redirect = req.originalUrl;
			res.redirect('/auth');
		} else {
			next();
		}
	},

	async checkToken(req, _res, next) {
		// synchronizes the oauth provider tokens if needed
		const user = await UserDAO.getUserById(req.session.user.id);

		if (!user) {
			if (next) next();
			return;
		}

		// TODO: remove `|| token` when all sessions have expired - possibly truncate the session table to force
		const stoken = req.session.token;

		if (stoken?.twitch) {
			if (!user.hasTwitchToken()) {
				// assumes token applies to use as-is
				user.setTwitchToken(stoken.twitch);
			} else {
				if (user.twitch_token.access_token != stoken.twitch.access_token) {
					// set the session token to be the same as user token
					req.session.token = {
						...stoken,
						twitch: user.twitch_token,
					};
				}
			}
		} else if (stoken?.access_token) {
			// old style - twitch only
			// convert to new style
			// TODO: modify when adding google auth
			if (!user.hasTwitchToken()) {
				// assumes token applies to use as-is
				user.setTwitchToken(stoken);
			} else {
				if (user.twitch_token.access_token != stoken.access_token) {
					// set the session token to be the same as user token
					req.session.token = { twitch: user.twitch_token };
				}
			}
		}

		if (user.hasTwitchToken() && !stoken?.twitch) {
			req.session.token = {
				twitch: user.twitch_token,
			};
		}

		if (stoken?.google) {
			if (!user.hasGoogleToken()) {
				// assumes token applies to use as-is
				user.setGoogleToken(stoken.google);
			} else {
				if (user.google_token.access_token != stoken.google.access_token) {
					// set the session token to be the same as user token
					req.session.token = {
						...stoken,
						google: user.google_token,
					};
				}
			}
		}

		if (next) next();
	},
};
