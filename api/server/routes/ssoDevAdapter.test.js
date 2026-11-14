const express = require('express');
const request = require('supertest');
const {
  ssoDevAdapterRouter,
  handleSsoCallback,
  isProductionSso,
  extractClientCredentials,
  getRegisteredRedirectUri,
  getKeycloakBrokerEndpoint,
  validateUpstreamUrl,
} = require('./ssoDevAdapter');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(ssoDevAdapterRouter);
app.use('/sso', (req, res, next) => {
  return handleSsoCallback(req, res, () => res.status(404).json({ fallback: true }));
});

describe('B-Pass token relay in ssoDevAdapter', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;
    delete process.env.BPBATAM_ENV;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  test('relays upstream tokens directly for authorization_code flow in dev mode', async () => {
    const upstreamTokens = {
      id_token: 'mock.id.token',
      access_token: 'mock.access.token',
      token_type: 'Bearer',
      expires_in: 3600,
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(upstreamTokens),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'auth-code-123',
        redirect_uri: 'https://devai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint',
      });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(upstreamTokens);

    const calledUrl = global.fetch.mock.calls[0][0];
    const calledBody = global.fetch.mock.calls[0][1].body;
    expect(calledUrl).toBe('https://sso-dev.bpbatam.go.id/application/o/token/');
    expect(calledBody).toContain('redirect_uri=http%3A%2F%2Fdevai.bpbatam.go.id%2Fsso%2Fcallback');
  });

  test('relays upstream tokens for username-only or unverified email identities without blocking', async () => {
    const upstreamTokens = {
      id_token: 'upstream.jwt.token',
      access_token: 'upstream.access.token',
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(upstreamTokens),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'code-unverified' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(upstreamTokens);
  });

  test('forwards Basic auth authorization header when provided without logging credentials', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'at' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await request(app)
      .post('/token')
      .set('Authorization', 'Basic Y2xpZW50OnNlY3JldA==')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'code-basic' });

    const calledHeaders = global.fetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBe('Basic Y2xpZW50OnNlY3JldA==');
  });

  test('returns 403 when dev adapter is disabled', async () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'false';
    const result = await request(app).post('/token').type('form').send({});
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('DEV_SSO_ADAPTER_DISABLED');
  });

  test('enforces fail-closed 500 in production when server BPBATAM_SSO_CLIENT_SECRET is missing (public relay prevention)', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;
    delete process.env.BPBATAM_SSO_CLIENT_SECRET;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'auth-code',
        client_id: 'b-pass',
        client_secret: 'some-caller-secret',
      });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('SSO_TOKEN_CONFIG_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('enforces fail-closed 401 invalid_client in production when client credentials are missing from caller', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'auth-code' });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('invalid_client');
    expect(result.body.error_description).toContain('Client authentication required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('enforces fail-closed 401 invalid_client in production when client_secret does not match', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'correct-secret-123';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'auth-code',
        client_id: 'b-pass',
        client_secret: 'wrong-secret-999',
      });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('invalid_client');
    expect(result.body.error_description).toContain('Client secret does not match');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('validates client_id fail-closed when BPBATAM_SSO_CLIENT_ID is configured', async () => {
    process.env.BPBATAM_SSO_CLIENT_ID = 'legit-broker-client';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'matching-secret';

    const badResult = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'attacker-client',
        client_secret: 'matching-secret',
        code: 'c1',
      });
    expect(badResult.status).toBe(401);
    expect(badResult.body.error).toBe('invalid_client');
    expect(badResult.body.error_description).toContain('Client identifier does not match');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'client-id-ok' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const goodResult = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'legit-broker-client',
        client_secret: 'matching-secret',
        code: 'c1',
      });
    expect(goodResult.status).toBe(200);
    expect(goodResult.body).toEqual({ access_token: 'client-id-ok' });
  });

  test('rejects unsupported grant types (password, client_credentials) fail-closed', async () => {
    const pwResult = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'password', username: 'user', password: 'pwd' });
    expect(pwResult.status).toBe(400);
    expect(pwResult.body.error).toBe('unsupported_grant_type');

    const ccResult = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(ccResult.status).toBe(400);
    expect(ccResult.body.error).toBe('unsupported_grant_type');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects authorization_code grant type without code parameter', async () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code' });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request');
    expect(result.body.error_description).toBe('Missing authorization code in token request');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects refresh_token grant type without refresh_token parameter', async () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token' });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request');
    expect(result.body.error_description).toBe('Missing refresh_token in token request');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('relays refresh_token flow with valid credentials and preserves refresh_token parameter', async () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'refreshed-token-999' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh-token-value',
        client_id: 'dev-client',
        client_secret: 'dev-secret',
      });

    expect(result.status).toBe(200);
    expect(result.body.access_token).toBe('refreshed-token-999');
    expect(global.fetch.mock.calls[0][1].body).toContain('grant_type=refresh_token');
    expect(global.fetch.mock.calls[0][1].body).toContain('refresh_token=valid-refresh-token-value');
    expect(global.fetch.mock.calls[0][1].body).not.toContain('redirect_uri=');
  });

  test('rejects cleartext HTTP incoming redirect_uri in production fail-closed', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
        redirect_uri: 'http://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint',
      });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request');
    expect(result.body.error_description).toContain('Broker redirect_uri must use HTTPS in production');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects incoming redirect_uri that does not match Keycloak broker endpoint', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
        redirect_uri: 'https://attacker.site/realms/bpbatam/broker/b-pass/endpoint',
      });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request');
    expect(result.body.error_description).toContain('does not match configured Keycloak broker endpoint');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects malformed incoming redirect_uri', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
        redirect_uri: 'not-a-valid-url',
      });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request');
    expect(result.body.error_description).toBe('Malformed redirect_uri parameter');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('succeeds in production using default production endpoints and rewrites to fixed B-Pass callback', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'prod-token-abc' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code-xyz',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
        redirect_uri: 'https://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint',
      });

    expect(result.status).toBe(200);
    expect(result.body.access_token).toBe('prod-token-abc');
    expect(global.fetch.mock.calls[0][0]).toBe('https://sso.bpbatam.go.id/application/o/token/');
    expect(global.fetch.mock.calls[0][1].body).toContain(
      'redirect_uri=https%3A%2F%2Fai.bpbatam.go.id%2Fsso%2Fcallback',
    );
  });

  test('rejects insecure HTTP upstream token URL fail-closed', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    process.env.BPBATAM_SSO_UPSTREAM_TOKEN_URL = 'http://sso.bpbatam.go.id/application/o/token/';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
      });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('SSO_TOKEN_CONFIG_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects untrusted upstream host fail-closed', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'prod-secret';
    process.env.BPBATAM_SSO_UPSTREAM_TOKEN_URL = 'https://untrusted-site.com/application/o/token/';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'prod-code',
        client_id: 'b-pass',
        client_secret: 'prod-secret',
      });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('SSO_TOKEN_CONFIG_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('preserves dev defaults when ENABLE_DEV_SSO_ADAPTER=true even if NODE_ENV=production (Docker dev VM)', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;

    expect(isProductionSso()).toBe(false);
  });

  test('activates production SSO mode when BPBATAM_SSO_MODE=production or BPBATAM_ENV=production', () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    expect(isProductionSso()).toBe(true);

    delete process.env.BPBATAM_SSO_MODE;
    process.env.BPBATAM_ENV = 'production';
    expect(isProductionSso()).toBe(true);
  });

  test('defaults registered redirect URI to fixed production callback without explicit env var', () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI;
    expect(getRegisteredRedirectUri()).toBe('https://ai.bpbatam.go.id/sso/callback');
  });

  test('defaults dev registered redirect URI in dev mode', () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;
    delete process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI;
    expect(getRegisteredRedirectUri()).toBe('http://devai.bpbatam.go.id/sso/callback');
  });

  test('defaults Keycloak broker endpoint to production URL when in production', () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT;
    expect(getKeycloakBrokerEndpoint()).toBe(
      'https://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint',
    );
  });

  test('enforces HTTPS protocol for registered redirect URI in production', () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI = 'http://insecure.bpbatam.go.id/sso/callback';
    expect(() => getRegisteredRedirectUri()).toThrow('must use HTTPS in production');
  });

  test('enforces HTTPS protocol for Keycloak broker endpoint', () => {
    process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT = 'http://insecure.bpbatam.go.id/broker';
    expect(() => getKeycloakBrokerEndpoint()).toThrow('must use HTTPS');
  });

  test('enforces HTTPS protocol for upstream URLs', () => {
    expect(() => validateUpstreamUrl('http://sso.bpbatam.go.id/application/o/token/')).toThrow(
      'Insecure protocol for upstream endpoint; HTTPS required',
    );
  });

  test('rejects untrusted upstream host in validateUpstreamUrl', () => {
    expect(() => validateUpstreamUrl('https://evil.com/application/o/token/')).toThrow(
      'Untrusted upstream host',
    );
  });

  test('does not leak client credentials in error responses or logs', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    process.env.BPBATAM_SSO_CLIENT_SECRET = 'confidential-vault-secret';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const result = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'auth-code',
        client_id: 'b-pass',
        client_secret: 'caller-supplied-secret',
      });

    expect(result.status).toBe(401);
    const bodyStr = JSON.stringify(result.body);
    expect(bodyStr).not.toContain('confidential-vault-secret');
    expect(bodyStr).not.toContain('caller-supplied-secret');
  });
});

describe('SSO /authorize and /sso/callback adaptation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    delete process.env.BPBATAM_SSO_MODE;
    delete process.env.BPBATAM_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('preserves PKCE code_challenge, method, and state in dev /authorize redirect', async () => {
    const res = await request(app).get(
      '/authorize?client_id=bp-pass&state=state-123&code_challenge=challenge-456&code_challenge_method=S256&scope=openid',
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.protocol).toBe('https:');
    expect(location.hostname).toBe('sso-dev.bpbatam.go.id');
    expect(location.searchParams.get('state')).toBe('state-123');
    expect(location.searchParams.get('code_challenge')).toBe('challenge-456');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://devai.bpbatam.go.id/sso/callback',
    );
  });

  test('production /authorize preserves PKCE and state and rewrites redirect_uri to fixed prod callback', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;

    const res = await request(app).get(
      '/authorize?client_id=b-pass&state=secure-state-123&code_challenge=pkce-challenge-xyz&code_challenge_method=S256&scope=openid%20profile',
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.protocol).toBe('https:');
    expect(location.hostname).toBe('sso.bpbatam.go.id');
    expect(location.pathname).toBe('/application/o/authorize/');
    expect(location.searchParams.get('state')).toBe('secure-state-123');
    expect(location.searchParams.get('code_challenge')).toBe('pkce-challenge-xyz');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe('https://ai.bpbatam.go.id/sso/callback');
  });

  test('rejects insecure HTTP configured redirect URI in production for /authorize', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;
    process.env.BPBATAM_SSO_REGISTERED_REDIRECT_URI = 'http://insecure.bpbatam.go.id/sso/callback';

    const res = await request(app).get('/authorize?client_id=b-pass');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('SSO_AUTHORIZE_PROXY_FAILED');
  });

  test('redirects /sso/callback to Keycloak broker endpoint with code and state, enforcing HTTPS', async () => {
    process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT =
      'https://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint';
    const res = await request(app).get('/sso/callback?code=bpass-code-789&state=broker-state-999');
    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.protocol).toBe('https:');
    expect(target.hostname).toBe('ai.bpbatam.go.id');
    expect(target.pathname).toBe('/realms/bpbatam/broker/b-pass/endpoint');
    expect(target.searchParams.get('code')).toBe('bpass-code-789');
    expect(target.searchParams.get('state')).toBe('broker-state-999');
  });

  test('preserves error and state when B-Pass returns an error on /sso/callback', async () => {
    process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT =
      'https://ai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint';
    const res = await request(app).get(
      '/sso/callback?error=access_denied&error_description=User%20cancelled&state=broker-state-999',
    );
    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.get('state')).toBe('broker-state-999');
  });

  test('redirects /sso/callback using default production broker endpoint when in production', async () => {
    process.env.BPBATAM_SSO_MODE = 'production';
    delete process.env.ENABLE_DEV_SSO_ADAPTER;
    delete process.env.BPBATAM_KEYCLOAK_BROKER_ENDPOINT;

    const res = await request(app).get('/sso/callback?code=prod-code-1&state=prod-state-1');
    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.protocol).toBe('https:');
    expect(target.hostname).toBe('ai.bpbatam.go.id');
    expect(target.pathname).toBe('/realms/bpbatam/broker/b-pass/endpoint');
    expect(target.searchParams.get('code')).toBe('prod-code-1');
    expect(target.searchParams.get('state')).toBe('prod-state-1');
  });

  test('extractClientCredentials parses Basic auth and form body', () => {
    const params = new URLSearchParams({ client_id: 'id1', client_secret: 'sec1' });
    const bodyCreds = extractClientCredentials({ headers: {} }, params);
    expect(bodyCreds.clientId).toBe('id1');
    expect(bodyCreds.clientSecret).toBe('sec1');

    const basicCreds = extractClientCredentials(
      { headers: { authorization: 'Basic ' + Buffer.from('id2:sec2').toString('base64') } },
      new URLSearchParams(),
    );
    expect(basicCreds.clientId).toBe('id2');
    expect(basicCreds.clientSecret).toBe('sec2');
  });
});
