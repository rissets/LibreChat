const rateLimit = require('express-rate-limit');
const { ErrorTypes, ViolationTypes } = require('librechat-data-provider');
const { limiterCache, removePorts } = require('@librechat/api');
const { isOAuthNavigation, redirectOAuthFailure } = require('~/server/middleware/oauthNavigation');
const { logViolation } = require('~/cache');

const { OAUTH_WINDOW = 5, OAUTH_MAX = 20, LOGIN_VIOLATION_SCORE: score } = process.env;
const windowMs = OAUTH_WINDOW * 60 * 1000;
const max = OAUTH_MAX;
const windowInMinutes = windowMs / 60000;
const message = `Too many OAuth attempts, please try again after ${windowInMinutes} minutes.`;

const handler = async (req, res) => {
  const type = ViolationTypes.LOGINS;
  const errorMessage = {
    type,
    max,
    windowInMinutes,
  };

  await logViolation(req, res, type, errorMessage, score);

  /** A browser navigation would render the JSON body as the page. */
  if (isOAuthNavigation(req)) {
    return redirectOAuthFailure(res, ErrorTypes.AUTH_RATE_LIMITED);
  }

  return res.status(429).json({ message });
};

const limiterOptions = {
  windowMs,
  max,
  handler,
  keyGenerator: removePorts,
  store: limiterCache('oauth_limiter'),
};

const oauthLimiter = rateLimit(limiterOptions);

module.exports = oauthLimiter;
