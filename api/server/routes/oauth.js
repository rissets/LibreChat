// file deepcode ignore NoRateLimitingForLogin: Rate limiting is handled by the `oauthLimiter` middleware
const express = require('express');
const passport = require('passport');
const { randomState } = require('openid-client');
const { logger } = require('@librechat/data-schemas');
const { ErrorTypes } = require('librechat-data-provider');
const {
  shouldUseSecureCookie,
  buildOAuthFailureLog,
  createOpenIDCallbackAuthenticator,
  createSetBalanceConfig,
  getOAuthFailureMessage,
  redirectToAuthFailure,
} = require('@librechat/api');
const {
  checkDomainAllowed,
  oauthLimiter,
  logHeaders,
  markOAuthNavigation,
} = require('~/server/middleware');
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
router.use(markOAuthNavigation);
const oauthHandler = createOAuthHandler();
const authenticateOpenIDCallback = (req, res, next) => {
  passport.authenticate('openid', { session: false, failureMessage: true }, (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (info && info.message === 'ACCOUNT_EXISTS_LINK_REQUIRED' && info.linkToken) {
      const isSecure = shouldUseSecureCookie();
      res.cookie('link_challenge', info.linkToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
        maxAge: 10 * 60 * 1000,
        path: '/',
      });
      const clientDomain = process.env.DOMAIN_CLIENT || 'http://localhost:3080';
      return res.redirect(`${clientDomain}/login?link=required`);
    }
    if (!user) {
      return redirectToAuthFailure(res, {
        clientDomain: domains.client,
        authFailedError: ErrorTypes.AUTH_FAILED,
      });
    }
    if (typeof req.logIn !== 'function') {
      req.user = user;
      return next();
    }
    return req.logIn(user, { session: false }, (loginErr) => {
      if (loginErr) return next(loginErr);
      return next();
    });
  })(req, res, next);
};

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
  oauthLimiter,
  passport.authenticate('google', {
    failureRedirect: `${domains.client}/oauth/error`,
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
  oauthLimiter,
  passport.authenticate('facebook', {
    failureRedirect: `${domains.client}/oauth/error`,
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
router.get(['/openid', '/openid/b-pass'], (req, res, next) => {
  const provider = req.path === '/openid/b-pass' ? 'b-pass' : undefined;
  if (req.session) req.session.bpassLogin = provider === 'b-pass';

  const authOptions = {
    session: false,
    state: randomState(),
  };

  if (provider === 'b-pass') {
    authOptions.kc_idp_hint = 'b-pass';
    authOptions.extraQueryParams = { kc_idp_hint: 'b-pass' };
  }

  return passport.authenticate('openid', authOptions)(req, res, next);
});

router.get(
  ['/openid/callback', '/sso/callback'],
  oauthLimiter,
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
  oauthLimiter,
  passport.authenticate('github', {
    failureRedirect: `${domains.client}/oauth/error`,
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
  oauthLimiter,
  passport.authenticate('discord', {
    failureRedirect: `${domains.client}/oauth/error`,
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
  oauthLimiter,
  passport.authenticate('apple', {
    failureRedirect: `${domains.client}/oauth/error`,
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
  oauthLimiter,
  passport.authenticate('saml', {
    failureRedirect: `${domains.client}/oauth/error`,
    failureMessage: true,
    session: false,
  }),
  oauthHandler,
);

module.exports = router;
