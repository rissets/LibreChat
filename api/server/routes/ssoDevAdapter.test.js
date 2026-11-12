const express = require('express');
const request = require('supertest');
const { ssoDevAdapterRouter } = require('./ssoDevAdapter');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(ssoDevAdapterRouter);

describe('B-Pass token relay in ssoDevAdapter', () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.ENABLE_DEV_SSO_ADAPTER;

  beforeEach(() => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'true';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnabled === undefined) delete process.env.ENABLE_DEV_SSO_ADAPTER;
    else process.env.ENABLE_DEV_SSO_ADAPTER = originalEnabled;
  });

  test('relays upstream tokens directly for authorization_code flow', async () => {
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
        redirect_uri: 'http://devai.bpbatam.go.id/realms/bpbatam/broker/b-pass/endpoint',
      });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(upstreamTokens);

    const calledUrl = global.fetch.mock.calls[0][0];
    const calledBody = global.fetch.mock.calls[0][1].body;
    expect(calledUrl).toContain('/application/o/token/');
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

  test('forwards Basic auth authorization header when provided', async () => {
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
      .send({ grant_type: 'authorization_code' });

    const calledHeaders = global.fetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBe('Basic Y2xpZW50OnNlY3JldA==');
  });

  test('returns 403 when dev adapter is disabled', async () => {
    process.env.ENABLE_DEV_SSO_ADAPTER = 'false';
    const result = await request(app).post('/token').type('form').send({});
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('DEV_SSO_ADAPTER_DISABLED');
  });
});
