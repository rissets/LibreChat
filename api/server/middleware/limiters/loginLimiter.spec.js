const express = require('express');
const request = require('supertest');

const originalEnv = process.env;

const createApp = () => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    DOMAIN_CLIENT: 'http://client.test',
    LOGIN_MAX: '1',
    LOGIN_WINDOW: '5',
    OAUTH_MAX: '1',
    OAUTH_WINDOW: '5',
  };

  jest.doMock('@librechat/api', () => ({
    ...jest.requireActual('@librechat/api'),
    limiterCache: jest.fn(() => undefined),
    removePorts: (req) => req?.['ip'],
  }));
  jest.doMock('~/cache', () => ({
    logViolation: jest.fn().mockResolvedValue(undefined),
  }));

  const { markOAuthNavigation } = require('../oauthNavigation');
  const loginLimiter = require('./loginLimiter');
  const oauthLimiter = require('./oauthLimiter');
  const { logViolation } = require('~/cache');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/api/auth/login', loginLimiter, (_req, res) => res.status(204).end());
  app.use('/oauth', markOAuthNavigation);
  app.get('/oauth/openid/callback', oauthLimiter, (_req, res) => res.status(204).end());

  return { app, logViolation };
};

describe('loginLimiter', () => {
  afterEach(() => {
    jest.dontMock('@librechat/api');
    jest.dontMock('~/cache');
    process.env = originalEnv;
  });

  it('answers API login requests with JSON', async () => {
    const { app, logViolation } = createApp();

    await request(app).post('/api/auth/login').set('x-forwarded-for', '198.51.100.4').expect(204);

    const response = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '198.51.100.4')
      .expect(429);

    expect(response.body).toEqual({
      message: 'Too many login attempts, please try again after 5 minutes.',
    });
    expect(logViolation).toHaveBeenCalledTimes(1);
  });

  it('redirects a rate limited OAuth navigation to the login page', async () => {
    const { app, logViolation } = createApp();

    await request(app).get('/oauth/openid/callback').set('x-forwarded-for', '203.0.113.7').expect(204);

    const response = await request(app)
      .get('/oauth/openid/callback')
      .set('x-forwarded-for', '203.0.113.7')
      .expect(302);

    expect(response.headers.location).toBe(
      'http://client.test/login?redirect=false&error=auth_rate_limited',
    );
    expect(response.text).not.toContain('Too many login attempts');
    expect(logViolation).toHaveBeenCalledTimes(1);
  });

  it('does not exhaust password login quota from OAuth attempts', async () => {
    const { app } = createApp();

    await request(app).post('/api/auth/login').set('x-forwarded-for', '203.0.113.9').expect(204);

    // OAuth callback has its own quota and succeeds rather than being blocked by prior password attempt
    await request(app)
      .get('/oauth/openid/callback')
      .set('x-forwarded-for', '203.0.113.9')
      .expect(204);

    // Prior OAuth callback does not block subsequent password login on the same IP
    await request(app)
      .get('/oauth/openid/callback')
      .set('x-forwarded-for', '203.0.113.11')
      .expect(204);

    await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.11')
      .expect(204);
  });
});
