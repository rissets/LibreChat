const { logger } = require('@librechat/data-schemas');
const { errorsToString } = require('librechat-data-provider');
const { Strategy: PassportLocalStrategy } = require('passport-local');
const {
  isEnabled,
  comparePassword,
  grandfatherLegacyEmailVerification,
  compareSecret,
} = require('@librechat/api');
const { findUsers, updateUser } = require('~/models');
const { loginSchema } = require('./validators');

async function validateLoginRequest(req) {
  const { error } = loginSchema.safeParse(req.body);
  return error ? errorsToString(error.errors) : null;
}

async function passportLogin(req, email, password, done) {
  try {
    const validationError = await validateLoginRequest(req);
    if (validationError) {
      logError('Passport Local Strategy - Validation Error', { email: req.body?.email });
      logger.error(`[Login] [Login failed] [Username: ${email}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: validationError });
    }

    const identifier = (email ?? '').trim();
    const query = {
      $or: [
        { email: identifier },
        { username: identifier.toLowerCase() },
      ],
    };

    const uniqueUsers = await findUsers(query, '+password', { limit: 2 });

    if (uniqueUsers.length === 0) {
      logError('Passport Local Strategy - User Not Found', { email: identifier });
      logger.error(`[Login] [Login failed] [Username: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Email does not exist.' });
    }

    if (uniqueUsers.length > 1) {
      logError('Passport Local Strategy - Ambiguous Identity', { identifier });
      logger.error(
        `[Login] [Login failed] [Ambiguous identity: ${identifier}] [Count: ${uniqueUsers.length}] [Request-IP: ${req.ip}]`,
      );
      return done(null, false, { message: 'Ambiguous identity.' });
    }

    const user = uniqueUsers[0];

    if (!user.password) {
      logError('Passport Local Strategy - User has no password', { email: identifier });
      logger.error(`[Login] [Login failed] [Username: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Email does not exist.' });
    }

    const isMatch = await comparePassword(user, password, { compare: compareSecret });
    if (!isMatch) {
      logError('Passport Local Strategy - Password does not match', { isMatch });
      logger.error(`[Login] [Login failed] [Username: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Incorrect password.' });
    }

    await grandfatherLegacyEmailVerification({ updateUser }, user);

    const unverifiedAllowed = isEnabled(process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN);
    if (user.expiresAt && unverifiedAllowed) {
      await updateUser(user._id, {});
    }

    if (user.email && !user.emailVerified && !unverifiedAllowed) {
      logError('Passport Local Strategy - Email not verified', { email: identifier });
      logger.error(`[Login] [Login failed] [Username: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, user, { message: 'Email not verified.' });
    }

    logger.info(`[Login] [Login successful] [Username: ${identifier}] [Request-IP: ${req.ip}]`);
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}

function logError(title, parameters) {
  const entries = Object.entries(parameters).map(([name, value]) => ({ name, value }));
  logger.error(title, { parameters: entries });
}

const localStrategy = () =>
  new PassportLocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      session: false,
      passReqToCallback: true,
    },
    passportLogin,
  );

localStrategy.passportLogin = passportLogin;

module.exports = localStrategy;
