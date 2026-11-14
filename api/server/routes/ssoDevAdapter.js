const express = require('express');
const crypto = require('crypto');
const { logger } = require('@librechat/data-schemas');

const router = express.Router();

const DEFAULT_DEV_UPSTREAM_AUTH = 'https://sso-dev.bpbatam.go.id/application/o/authorize/';
const DEFAULT_DEV_UPSTREAM_TOKEN = 'https://sso-dev.bpbatam.go.id/application/o/token/';
const DEFAULT_DEV_REGISTERED_REDIRECT = 'http://devai.bpbatam.go.id/sso/callback';
const DEFAULT_DEV_KEYCLOAK_BROKER_ENDPOINT =
  'https://devai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint';

const DEFAULT_PROD_UPSTREAM_AUTH = 'https://sso.bpbatam.go.id/application/o/authorize/';
const DEFAULT_PROD_UPSTREAM_TOKEN = 'https://sso.bpbatam.go.id/application/o/token/';
const DEFAULT_PROD_REGISTERED_REDIRECT = 'https://ai.bpbatam.go.id/sso/callback';
const DEFAULT_PROD_KEYCLOAK_BROKER_ENDPOINT =
  'https://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint';

const DEFAULT_UPSTREAM_AUTH = DEFAULT_DEV_UPSTREAM_AUTH;
const DEFAULT_UPSTREAM_TOKEN = DEFAULT_DEV_UPSTREAM_TOKEN;
const DEFAULT_REGISTERED_REDIRECT = DEFAULT_DEV_REGISTERED_REDIRECT;
const DEFAULT_KEYCLOAK_BROKER_ENDPOINT = DEFAULT_DEV_KEYCLOAK_BROKER_ENDPOINT;

/**
 * Determine whether production SSO mode is active.
 * Note: Docker containers on dev VMs may set NODE_ENV=production.
 * To prevent breaking dev setups, ENABLE_DEV_SSO_ADAPTER='true' preserves dev defaults
 * unless production mode is explicitly designated (BPBATAM_SSO_MODE=production).
 */
function isProductionSso() {
  if (process.env.BPBATAM_SSO_MODE === 'production' || process.env.BPBATAM_ENV === 'production') {
    return true;
  }
  if (
    process.env.BPBATAM_SSO_MODE === 'development' ||
    process.env.ENABLE_DEV_SSO_ADAPTER === 'true'
  ) {
    return false;
  }
  return process.env.NODE_ENV === 'production' || process.env.ENABLE_SSO_ADAPTER === 'true';
}

function isDevAdapterEnabled() {
  if (process.env.BPBATAM_SSO_ADAPTER_ENABLED === 'false') return false;
  if (process.env.ENABLE_SSO_ADAPTER === 'false') return false;
  if (process.env.ENABLE_DEV_SSO_ADAPTER === 'false' && !isProductionSso()) return false;
  return (
    process.env.ENABLE_DEV_SSO_ADAPTER === 'true' ||
    process.env.ENABLE_SSO_ADAPTER === 'true' ||
    process.env.BPBATAM_SSO_ADAPTER_ENABLED === 'true' ||
    Boolean(process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI) ||
    isProductionSso()
  );
}

function getAllowedUpstreamHosts() {
  const hosts = new Set();
  const configured = process.env.BPBATAM_SSO_ALLOWED_HOSTS;
  if (configured) {
    for (const h of configured.split(',')) {
      const trimmed = h.trim();
      if (trimmed) hosts.add(trimmed);
    }
  }
  if (isProductionSso()) {
    hosts.add('sso.bpbatam.go.id');
  } else {
    hosts.add('sso-dev.bpbatam.go.id');
    hosts.add('sso.bpbatam.go.id');
  }
  return hosts;
}

function validateUpstreamUrl(urlStr, defaultUrl) {
  const target = urlStr || defaultUrl;
  if (!target) {
    throw new Error('Upstream URL is required');
  }
  const parsed = new URL(target);
  if (parsed.protocol !== 'https:') {
    throw new Error('Insecure protocol for upstream endpoint; HTTPS required');
  }
  const allowed = getAllowedUpstreamHosts();
  if (!allowed.has(parsed.hostname)) {
    throw new Error(`Untrusted upstream host: ${parsed.hostname}`);
  }
  if (!parsed.pathname.startsWith('/application/o/')) {
    throw new Error(`Untrusted upstream path: ${parsed.pathname}`);
  }
  return parsed;
}

function getRegisteredRedirectUri() {
  const configured = process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI;
  if (configured) {
    const parsed = new URL(configured);
    if (isProductionSso() && parsed.protocol !== 'https:') {
      throw new Error('BPBATAM_SSO_REGISTERED_REDIRECT_URI must use HTTPS in production');
    }
    return configured;
  }
  return isProductionSso() ? DEFAULT_PROD_REGISTERED_REDIRECT : DEFAULT_DEV_REGISTERED_REDIRECT;
}

function getKeycloakBrokerEndpoint() {
  const configured = process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT;
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:') {
      throw new Error('BPBATAM_KEYCLOAK_BROKER_ENDPOINT must use HTTPS');
    }
    return configured;
  }
  return isProductionSso()
    ? DEFAULT_PROD_KEYCLOAK_BROKER_ENDPOINT
    : DEFAULT_DEV_KEYCLOAK_BROKER_ENDPOINT;
}

function extractClientCredentials(req, params) {
  let clientId = params.get('client_id');
  let clientSecret = params.get('client_secret');
  const authHeader = req.headers?.authorization;

  if (authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx >= 0) {
        const rawUser = decoded.slice(0, colonIdx);
        const rawPass = decoded.slice(colonIdx + 1);
        try {
          clientId = decodeURIComponent(rawUser);
        } catch {
          clientId = rawUser;
        }
        try {
          clientSecret = decodeURIComponent(rawPass);
        } catch {
          clientSecret = rawPass;
        }
      }
    } catch {
      // ignore base64 decode failure
    }
  }

  return { clientId, clientSecret, authHeader };
}

/**
 * Authorization proxy for Keycloak broker:
 * Rewrites the broker callback redirect_uri to the fixed registered redirect URI
 * expected by B-Pass / Authentik, then redirects browser to Authentik authorize endpoint.
 * Upstream URL is validated against strict HTTPS allowlist to prevent SSRF.
 */
router.get('/authorize', (req, res) => {
  if (!isDevAdapterEnabled()) {
    return res.status(403).json({ error: 'DEV_SSO_ADAPTER_DISABLED' });
  }

  try {
    const defaultAuth = isProductionSso()
      ? DEFAULT_PROD_UPSTREAM_AUTH
      : DEFAULT_DEV_UPSTREAM_AUTH;
    const upstreamUrl = validateUpstreamUrl(
      process.env.BPBATAM_SSO_UPSTREAM_AUTH_URL,
      defaultAuth,
    );
    const targetRedirectUri = getRegisteredRedirectUri();

    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        upstreamUrl.searchParams.set(key, value);
      } else if (Array.isArray(value) && typeof value[0] === 'string') {
        upstreamUrl.searchParams.set(key, value[0]);
      }
    }
    // Fix redirect_uri to the exact registered redirect URI in Authentik
    upstreamUrl.searchParams.set('redirect_uri', targetRedirectUri);

    return res.redirect(302, upstreamUrl.toString());
  } catch (error) {
    logger.error('[ssoDevAdapter] Failed to construct authorize URL:', error.message);
    return res.status(500).json({ error: 'SSO_AUTHORIZE_PROXY_FAILED' });
  }
});

/**
 * Token proxy for Keycloak broker:
 * Keycloak backend sends POST to exchange authorization code for token.
 *
 * SECURITY & AUTHENTICATION ARCHITECTURE:
 * 1. Fail-closed caller authentication:
 *    Keycloak OIDC Identity Provider authenticates using Client Authentication (RFC 6749 Section 2.3)
 *    via client_secret_post or client_secret_basic. Unauthenticated requests lacking client credentials
 *    are rejected immediately with 401 invalid_client in production or when client auth is required.
 * 2. Credential verification:
 *    When BPBATAM_SSO_CLIENT_ID or BPBATAM_SSO_CLIENT_SECRET is configured, caller credentials are
 *    strictly verified using constant-time comparison before proxying to upstream.
 * 3. Flow & grant restriction:
 *    Only authorization_code and refresh_token flows are permitted. Code is strictly required for
 *    authorization_code. Incoming broker redirect_uri must match the Keycloak broker endpoint.
 * 4. Reverse Proxy Isolation Requirement:
 *    Private IP addresses and X-Forwarded-For headers are NOT trusted authentication mechanisms.
 *    To prevent exposure as an open relay, this endpoint MUST be blocked from external/public access
 *    on the reverse proxy (F5 BIG-IP / Nginx). Only internal traffic from Keycloak should be routed here.
 */
router.post('/token', async (req, res) => {
  if (!isDevAdapterEnabled()) {
    return res.status(403).json({ error: 'DEV_SSO_ADAPTER_DISABLED' });
  }

  try {
    const params = new URLSearchParams();
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string') {
          params.set(key, value);
        }
      }
    }

    const grantType = params.get('grant_type');
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code and refresh_token flows are permitted on this broker adapter',
      });
    }

    const { clientId, clientSecret, authHeader } = extractClientCredentials(req, params);

    // Fail-closed caller authentication & relay protection:
    // In production, server MUST have BPBATAM_SSO_CLIENT_SECRET configured.
    // If client secret is missing in server environment, fail closed immediately
    // so the adapter cannot be abused as an unauthenticated or public relay.
    const expectedClientSecret = process.env.BPBATAM_SSO_CLIENT_SECRET;
    if (isProductionSso() && !expectedClientSecret) {
      throw new Error('BPBATAM_SSO_CLIENT_SECRET is required in production');
    }

    const mustAuthenticate =
      isProductionSso() ||
      process.env.BPBATAM_SSO_REQUIRE_CLIENT_AUTH === 'true' ||
      Boolean(process.env.BPBATAM_SSO_CLIENT_ID) ||
      Boolean(expectedClientSecret);

    if (mustAuthenticate && (!clientId || !clientSecret)) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication required on SSO token adapter',
      });
    }

    // Validate client_id against configured value if set
    const expectedClientId =
      process.env.BPBATAM_SSO_CLIENT_ID || process.env.BPBATAM_SSO_EXPECTED_CLIENT_ID;
    if (expectedClientId && clientId !== expectedClientId) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client identifier does not match configured broker client',
      });
    }

    // Validate client_secret against configured value if set
    if (expectedClientSecret) {
      const secretBuf = Buffer.from(clientSecret || '');
      const expectedBuf = Buffer.from(expectedClientSecret);
      const match =
        secretBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(secretBuf, expectedBuf);
      if (!match) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client secret does not match configured broker client',
        });
      }
    }

    // Validate authorization_code grant requirements
    if (grantType === 'authorization_code') {
      if (!params.get('code')) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing authorization code in token request',
        });
      }

      // Validate incoming redirect_uri if supplied
      const incomingRedirectUri = params.get('redirect_uri');
      if (incomingRedirectUri) {
        try {
          const parsedIncoming = new URL(incomingRedirectUri);
          if (isProductionSso() && parsedIncoming.protocol !== 'https:') {
            return res.status(400).json({
              error: 'invalid_request',
              error_description: 'Broker redirect_uri must use HTTPS in production',
            });
          }
          const brokerEndpoint = getKeycloakBrokerEndpoint();
          const parsedBroker = new URL(brokerEndpoint);
          const cleanIncomingPath = parsedIncoming.pathname.replace(/\/+$/, '');
          const cleanBrokerPath = parsedBroker.pathname.replace(/\/+$/, '');
          if (
            parsedIncoming.hostname !== parsedBroker.hostname ||
            cleanIncomingPath !== cleanBrokerPath
          ) {
            return res.status(400).json({
              error: 'invalid_request',
              error_description: 'Incoming redirect_uri does not match configured Keycloak broker endpoint',
            });
          }
        } catch (err) {
          if (
            err.message &&
            (err.message.includes('required in production') ||
              err.message.includes('must use HTTPS'))
          ) {
            throw err;
          }
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Malformed redirect_uri parameter',
          });
        }
      }
    } else if (grantType === 'refresh_token') {
      if (!params.get('refresh_token')) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing refresh_token in token request',
        });
      }
    }

    const defaultToken = isProductionSso()
      ? DEFAULT_PROD_UPSTREAM_TOKEN
      : DEFAULT_DEV_UPSTREAM_TOKEN;
    const upstreamUrl = validateUpstreamUrl(
      process.env.BPBATAM_SSO_UPSTREAM_TOKEN_URL,
      defaultToken,
    );
    const targetRedirectUri = getRegisteredRedirectUri();

    // Only rewrite redirect_uri for authorization_code flow; preserve other legitimate grant types
    if (grantType === 'authorization_code') {
      params.set('redirect_uri', targetRedirectUri);
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    // Forward Basic auth (client_secret_basic) from Keycloak if present, without logging
    if (authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('basic ')) {
      headers.Authorization = authHeader;
    }

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: 'POST',
      headers,
      body: params.toString(),
      redirect: 'error', // Disallow upstream redirects
      signal: AbortSignal.timeout(15000),
    });

    const responseData = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';

    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', contentType);
    return res.send(responseData);
  } catch (error) {
    logger.error('[ssoDevAdapter] Failed to forward token request:', error.message);
    const isConfigError =
      error.message &&
      (error.message.includes('required in production') ||
        error.message.includes('must use HTTPS') ||
        error.message.includes('Insecure protocol') ||
        error.message.includes('Untrusted upstream'));
    return res.status(isConfigError ? 500 : 502).json({
      error: isConfigError ? 'SSO_TOKEN_CONFIG_ERROR' : 'SSO_TOKEN_PROXY_FAILED',
    });
  }
});

function handleSsoCallback(req, res, next) {
  if (req.path === '/callback' || req.path === '/sso/callback') {
    if (
      isDevAdapterEnabled() &&
      ((req.query.code && req.query.state) || (req.query.error && req.query.state))
    ) {
      try {
        const brokerEndpoint = getKeycloakBrokerEndpoint();
        const targetUrl = new URL(brokerEndpoint);
        targetUrl.protocol = 'https:';
        for (const [key, value] of Object.entries(req.query)) {
          if (typeof value === 'string') {
            targetUrl.searchParams.set(key, value);
          } else if (Array.isArray(value) && typeof value[0] === 'string') {
            targetUrl.searchParams.set(key, value[0]);
          }
        }
        return res.redirect(302, targetUrl.toString());
      } catch (error) {
        logger.error('[ssoDevAdapter] Failed to resolve broker endpoint:', error.message);
        return res.status(500).json({ error: 'SSO_BROKER_REDIRECT_FAILED' });
      }
    }
  }
  return next();
}

router.get('/callback', (req, res, next) => handleSsoCallback(req, res, next));

module.exports = {
  ssoDevAdapterRouter: router,
  isDevAdapterEnabled,
  isSsoAdapterEnabled: isDevAdapterEnabled,
  isProductionSso,
  handleSsoCallback,
  getKeycloakBrokerEndpoint,
  getRegisteredRedirectUri,
  validateUpstreamUrl,
  extractClientCredentials,
  getAllowedUpstreamHosts,
  DEFAULT_REGISTERED_REDIRECT,
  DEFAULT_KEYCLOAK_BROKER_ENDPOINT,
  DEFAULT_UPSTREAM_AUTH,
  DEFAULT_UPSTREAM_TOKEN,
  DEFAULT_PROD_REGISTERED_REDIRECT,
  DEFAULT_PROD_KEYCLOAK_BROKER_ENDPOINT,
  DEFAULT_PROD_UPSTREAM_AUTH,
  DEFAULT_PROD_UPSTREAM_TOKEN,
  DEFAULT_DEV_REGISTERED_REDIRECT,
  DEFAULT_DEV_KEYCLOAK_BROKER_ENDPOINT,
  DEFAULT_DEV_UPSTREAM_AUTH,
  DEFAULT_DEV_UPSTREAM_TOKEN,
};
