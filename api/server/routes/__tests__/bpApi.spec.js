const express = require('express');
const request = require('supertest');

const mockValidateAgentApiKey = jest.fn();
const mockFindUser = jest.fn();
const mockListAgentApiKeys = jest.fn();
const mockRecordAgentApiKeyUsage = jest.fn().mockResolvedValue(undefined);
const mockAxiosPost = jest.fn();

jest.mock('axios', () => ({
  post: (...args) => mockAxiosPost(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  validateAgentApiKey: (...args) => mockValidateAgentApiKey(...args),
  findUser: (...args) => mockFindUser(...args),
  listAgentApiKeys: (...args) => mockListAgentApiKeys(...args),
  recordAgentApiKeyUsage: (...args) => mockRecordAgentApiKeyUsage(...args),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-1', email: 'user@example.test' };
    next();
  },
}));

const bpApi = require('../bpApi');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bp-ai', bpApi);
  return app;
}

describe('BP Chat API key endpoint', () => {
  const app = createApp();
  const snapshot = {
    router_credential: 'router-secret',
    models: [
      { model: 'bp/gpt-5.6-sol-low', name: 'GPT 5.6 Sol (Low)', provider: 'openai' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONTROL_PLANE_URL = 'http://control-plane:8000';
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-secret';
    process.env.OMNIROUTE_BASE_URL = 'http://omniroute:20128/v1';
    mockValidateAgentApiKey.mockResolvedValue({ userId: 'user-1', keyId: 'key-1' });
    mockFindUser.mockResolvedValue({ _id: 'user-1', id: 'user-1', email: 'user@example.test' });
    mockListAgentApiKeys.mockResolvedValue([
      {
        id: 'key-1',
        name: 'Local integration',
        keyPrefix: 'bp_live_abc',
        totalRequests: 2,
        successfulRequests: 1,
        failedRequests: 1,
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      },
    ]);
    mockAxiosPost.mockResolvedValue({ data: snapshot });
  });

  it('rejects requests without a bearer key', async () => {
    const response = await request(app).get('/api/bp-ai/v1/models');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('missing_api_key');
    expect(mockValidateAgentApiKey).not.toHaveBeenCalled();
  });

  it('returns entitled models and hides the internal router credential', async () => {
    const response = await request(app)
      .get('/api/bp-ai/v1/models')
      .set('Authorization', 'Bearer bp_live_test');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ id: 'bp/gpt-5.6-sol-low', name: 'GPT 5.6 Sol (Low)' }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain('router-secret');
    expect(mockAxiosPost).toHaveBeenCalledWith(
      'http://control-plane:8000/api/platform/internal/identity/resolve/',
      expect.objectContaining({ email: 'user@example.test' }),
      expect.objectContaining({ headers: { 'X-BP-Internal-Token': 'internal-secret' } }),
    );
  });

  it('enforces model entitlements before forwarding a completion', async () => {
    const response = await request(app)
      .post('/api/bp-ai/v1/chat/completions')
      .set('Authorization', 'Bearer bp_live_test')
      .send({ model: 'bp/unknown', messages: [{ role: 'user', content: 'hi' }] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('model_not_entitled');
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockRecordAgentApiKeyUsage).toHaveBeenCalledWith('key-1', {
      statusCode: 403,
    });
  });

  it('forwards entitled chat requests with the internal router credential and records usage', async () => {
    mockAxiosPost
      .mockResolvedValueOnce({ data: snapshot })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: {
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Halo' } }],
          usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
        },
      });

    const response = await request(app)
      .post('/api/bp-ai/v1/chat/completions')
      .set('Authorization', 'Bearer bp_live_test')
      .send({ model: 'bp/gpt-5.6-sol-low', messages: [{ role: 'user', content: 'hi' }] });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toBe('Halo');
    expect(mockAxiosPost).toHaveBeenNthCalledWith(
      2,
      'http://omniroute:20128/v1/chat/completions',
      expect.objectContaining({ model: 'bp/gpt-5.6-sol-low' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer router-secret' }) }),
    );
    expect(mockRecordAgentApiKeyUsage).toHaveBeenCalledWith('key-1', {
      statusCode: 200,
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    });
  });

  it('returns endpoint and aggregate usage for the settings page', async () => {
    const response = await request(app)
      .get('/api/bp-ai/api-keys/usage')
      .set('Host', 'chat.example.test')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.body.endpoint).toBe('https://chat.example.test/api/bp-ai/v1');
    expect(response.body.totals).toEqual({
      totalRequests: 2,
      successfulRequests: 1,
      failedRequests: 1,
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
  });
});
