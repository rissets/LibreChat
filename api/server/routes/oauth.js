// file deepcode ignore NoRateLimitingForLogin: Rate limiting is handled by the `loginLimiter` middleware
const express = require('express');
const passport = require('passport');
const { randomState } = require('openid-client');
const { logger } = require('@librechat/data-schemas');
const { ErrorTypes } = require('librechat-data-provider');
const {
  buildOAuthFailureLog,
  createOpenIDCallbackAuthenticator,
  createSetBalanceConfig,
  getOAuthFailureMessage,
  redirectToAuthFailure,
} = require('@librechat/api');
const { checkDomainAllowed, loginLimiter, logHeaders } = require('~/server/middleware');
const { createOAuthHandler } = require('~/server/controllers/auth/oauth');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();

const domains = {
  client: process.env.DOMAIN_CLIENT,
  server: process.env.DOMAIN_SERVER,
};

const authFailureRedirectOptions = {
  clientDomain: domains.client,
  authFailedError: ErrorTypes.AUTH_FAILED,
};

router.use(logHeaders);
// An OAuth callback is a response to a state-bound authorization request, not a
// fresh login attempt. Counting the callback (and the resulting error hand-off)
// alongside the authorization start makes a normal provider redirect consume two
// limiter slots and can lock out a user while switching accounts. Keep the rate
// limit on every authorization initiation endpoint, but let callbacks complete
// through their own state/PKCE validation.
router.use((req, res, next) => {
  if (req.path === '/error' || req.path.endsWith('/callback')) {
    return next();
  }
  return loginLimiter(req, res, next);
});

const oauthHandler = createOAuthHandler();
const authenticateOpenIDCallback = createOpenIDCallbackAuthenticator({
  passport,
  logger,
  ...authFailureRedirectOptions,
});

router.get('/error', (req, res) => {
  /** A single error message is pushed by passport when authentication fails. */
  const errorMessage = getOAuthFailureMessage(req);
  logger.warn(
    '[OAuth] Authentication failed',
    buildOAuthFailureLog({
      provider: 'unknown',
      req,
      info: { message: errorMessage },
      defaultMessage: errorMessage,
    }),
  );

  redirectToAuthFailure(res, authFailureRedirectOptions);
});

/**
 * Google Routes
 */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email'],
    session: false,
  }),
);

router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
    scope: ['openid', 'profile', 'email'],
  }),
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * Facebook Routes
 */
router.get(
  '/facebook',
  passport.authenticate('facebook', {
    scope: ['public_profile'],
    profileFields: ['id', 'email', 'name'],
    session: false,
  }),
);

router.get(
  '/facebook/callback',
  passport.authenticate('facebook', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
    scope: ['public_profile'],
    profileFields: ['id', 'email', 'name'],
  }),
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * OpenID Routes
 */
router.get('/openid', (req, res, next) => {
  return passport.authenticate('openid', {
    session: false,
    state: randomState(),
  })(req, res, next);
});

router.get(
  '/openid/callback',
  authenticateOpenIDCallback,
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * GitHub Routes
 */
router.get(
  '/github',
  passport.authenticate('github', {
    scope: ['user:email', 'read:user'],
    session: false,
  }),
);

router.get(
  '/github/callback',
  passport.authenticate('github', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
    scope: ['user:email', 'read:user'],
  }),
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * Discord Routes
 */
router.get(
  '/discord',
  passport.authenticate('discord', {
    scope: ['identify', 'email'],
    session: false,
  }),
);

router.get(
  '/discord/callback',
  passport.authenticate('discord', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
    scope: ['identify', 'email'],
  }),
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * Apple Routes
 */
router.get(
  '/apple',
  passport.authenticate('apple', {
    session: false,
  }),
);

router.post(
  '/apple/callback',
  passport.authenticate('apple', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
  }),
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

/**
 * SAML Routes
 */
router.get(
  '/saml',
  passport.authenticate('saml', {
    session: false,
  }),
);

router.post(
  '/saml/callback',
  passport.authenticate('saml', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
  }),
  oauthHandler,
);

module.exports = router;
