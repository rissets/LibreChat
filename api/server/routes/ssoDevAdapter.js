const express = require('express');
const { logger } = require('@librechat/data-schemas');

const router = express.Router();

const DEFAULT_UPSTREAM_AUTH = 'https://sso-dev.bpbatam.go.id/application/o/authorize/';
const DEFAULT_UPSTREAM_TOKEN = 'https://sso-dev.bpbatam.go.id/application/o/token/';
const DEFAULT_REGISTERED_REDIRECT = 'http://devai.bpbatam.go.id/sso/callback';
const DEFAULT_KEYCLOAK_BROKER_ENDPOINT =
  'https://devai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint';

const ALLOWED_UPSTREAM_HOSTS = new Set(['sso-dev.bpbatam.go.id', 'sso.bpbatam.go.id']);

function isDevAdapterEnabled() {
  return process.env.ENABLE_DEV_SSO_ADAPTER === 'true';
}

function validateUpstreamUrl(urlStr, defaultUrl) {
  const target = urlStr || defaultUrl;
  const parsed = new URL(target);
  if (parsed.protocol !== 'https:') {
    throw new Error('Insecure protocol for upstream endpoint; HTTPS required');
  }
  if (!ALLOWED_UPSTREAM_HOSTS.has(parsed.hostname)) {
    throw new Error(`Untrusted upstream host: ${parsed.hostname}`);
  }
  if (!parsed.pathname.startsWith('/application/o/')) {
    throw new Error(`Untrusted upstream path: ${parsed.pathname}`);
  }
  return parsed;
}

/**
 * Authorization proxy for dev Keycloak broker:
 * Rewrites the broker callback redirect_uri to the fixed registered redirect URI
 * expected by B-Pass / Authentik, then redirects browser to Authentik authorize endpoint.
 * Upstream URL is validated against strict HTTPS allowlist to prevent SSRF.
 */
router.get('/authorize', (req, res) => {
  if (!isDevAdapterEnabled()) {
    return res.status(403).json({ error: 'DEV_SSO_ADAPTER_DISABLED' });
  }

  try {
    const upstreamUrl = validateUpstreamUrl(
      process.env.BPBATAM_SSO_UPSTREAM_AUTH_URL,
      DEFAULT_UPSTREAM_AUTH,
    );
    const targetRedirectUri =
      process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI || DEFAULT_REGISTERED_REDIRECT;

    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        upstreamUrl.searchParams.set(key, value);
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
 * Token proxy for dev Keycloak broker:
 * Keycloak's backend sends POST to exchange authorization code for token.
 * For authorization_code grants, rewrites redirect_uri in the POST body to the fixed registered redirect URI.
 * Forwards client_secret_basic (Authorization header) when present without logging credentials.
 * Upstream URL is validated against strict HTTPS allowlist; redirects are disabled.
 */
router.post('/token', async (req, res) => {
  if (!isDevAdapterEnabled()) {
    return res.status(403).json({ error: 'DEV_SSO_ADAPTER_DISABLED' });
  }

  try {
    const upstreamUrl = validateUpstreamUrl(
      process.env.BPBATAM_SSO_UPSTREAM_TOKEN_URL,
      DEFAULT_UPSTREAM_TOKEN,
    );
    const targetRedirectUri =
      process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI || DEFAULT_REGISTERED_REDIRECT;

    const params = new URLSearchParams();
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string') {
          params.set(key, value);
        }
      }
    }

    // Only rewrite redirect_uri for authorization_code flow; preserve other legitimate grant types
    const grantType = params.get('grant_type');
    if (grantType === 'authorization_code') {
      params.set('redirect_uri', targetRedirectUri);
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    // Forward Basic auth (client_secret_basic) from Keycloak if present, without logging
    const authHeader = req.headers.authorization;
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
    return res.status(502).json({ error: 'SSO_TOKEN_PROXY_FAILED' });
  }
});

module.exports = {
  ssoDevAdapterRouter: router,
  isDevAdapterEnabled,
  DEFAULT_REGISTERED_REDIRECT,
  DEFAULT_KEYCLOAK_BROKER_ENDPOINT,
};
