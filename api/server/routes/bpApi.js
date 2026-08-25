const axios = require('axios');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

function publicEndpoint(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}/api/bp-ai/v1`;
}

function routerBaseUrl() {
  const configured = String(process.env.OMNIROUTE_BASE_URL || 'http://omniroute:20128/v1');
  return configured.replace(/\/$/, '');
}

function internalHeaders() {
  return { 'X-BP-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN || '' };
}

async function resolveAccess(user) {
  const controlPlaneUrl = String(process.env.CONTROL_PLANE_URL || '').replace(/\/$/, '');
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!controlPlaneUrl || !internalToken || !user?.email) {
    const error = new Error('access_service_not_configured');
    error.status = 503;
    throw error;
  }

  const response = await axios.post(
    `${controlPlaneUrl}/api/platform/internal/identity/resolve/`,
    { email: user.email, external_user_id: String(user._id || user.id || '') },
    { timeout: 8000, headers: internalHeaders() },
  );
  return response.data || {};
}

function allowedModels(snapshot) {
  return new Set(
    (Array.isArray(snapshot?.models) ? snapshot.models : [])
      .map((item) => item?.model)
      .filter((model) => typeof model === 'string' && model.length > 0),
  );
}

function extractUsage(payload) {
  const usage = payload?.usage || {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
  };
}

function openAiModels(snapshot) {
  const observedAt = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: (Array.isArray(snapshot?.models) ? snapshot.models : []).map((item) => ({
      id: item.model,
      object: 'model',
      created: observedAt,
      owned_by: item.provider || 'bp-batam',
      name: item.name || item.model,
    })),
  };
}

function sendUpstreamError(res, error) {
  const status = error.response?.status || error.status || 502;
  const upstream = error.response?.data;
  if (upstream && typeof upstream === 'object') {
    return res.status(status).json(upstream);
  }
  return res.status(status).json({
    error: {
      message: status === 503 ? 'AI access service is temporarily unavailable' : 'AI upstream request failed',
      type: 'upstream_error',
      code: status === 503 ? 'service_unavailable' : 'upstream_error',
    },
  });
}

async function recordUsage(keyId, statusCode, usage) {
  if (!keyId || typeof db.recordAgentApiKeyUsage !== 'function') return;
  await db.recordAgentApiKeyUsage(keyId, { statusCode, ...(usage || {}) });
}

async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Expected Authorization: Bearer <api_key>', type: 'invalid_request_error', code: 'missing_api_key' },
    });
  }
  const validation = await db.validateAgentApiKey(authHeader.slice(7).trim());
  if (!validation) {
    return res.status(401).json({
      error: { message: 'Invalid or expired API key', type: 'invalid_request_error', code: 'invalid_api_key' },
    });
  }
  const user = await db.findUser({ _id: validation.userId });
  if (!user) {
    return res.status(401).json({
      error: { message: 'User for API key no longer exists', type: 'invalid_request_error', code: 'invalid_api_key' },
    });
  }
  user.id = String(user._id);
  req.user = user;
  req.apiKeyId = validation.keyId;
  return next();
}

// The management page uses the same authenticated session as BP Chat. The
// raw key is never returned here; it is shown only once by POST /api/api-keys.
router.get('/api-keys/usage', requireJwtAuth, async (req, res) => {
  try {
    const keys = await db.listAgentApiKeys(req.user?.id || '');
    // The model catalog is resolved for this identity, not from a global
    // LibreChat/provider list. Restricted assignments, including an empty
    // assignment, are therefore reflected in both the UI and /v1/models.
    const snapshot = await resolveAccess(req.user);
    const models = openAiModels(snapshot).data;
    const totals = keys.reduce(
      (summary, key) => ({
        totalRequests: summary.totalRequests + Number(key.totalRequests || 0),
        successfulRequests: summary.successfulRequests + Number(key.successfulRequests || 0),
        failedRequests: summary.failedRequests + Number(key.failedRequests || 0),
        inputTokens: summary.inputTokens + Number(key.inputTokens || 0),
        outputTokens: summary.outputTokens + Number(key.outputTokens || 0),
        totalTokens: summary.totalTokens + Number(key.totalTokens || 0),
      }),
      { totalRequests: 0, successfulRequests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
    return res.json({ endpoint: publicEndpoint(req), models, keys, totals });
  } catch (error) {
    logger.error('[BPApi] Usage summary failed', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to load API usage' });
  }
});

router.get('/v1/models', requireApiKey, async (req, res) => {
  try {
    const snapshot = await resolveAccess(req.user);
    return res.json(openAiModels(snapshot));
  } catch (error) {
    logger.error('[BPApi] Models request failed', { error: error.message, userId: req.user?.id });
    return sendUpstreamError(res, error);
  }
});

router.post('/v1/chat/completions', requireApiKey, async (req, res) => {
  const requestedModel = req.body?.model;
  if (!requestedModel || typeof requestedModel !== 'string') {
    return res.status(400).json({
      error: { message: 'model is required', type: 'invalid_request_error', code: 'missing_model' },
    });
  }

  let snapshot;
  try {
    snapshot = await resolveAccess(req.user);
    if (!allowedModels(snapshot).has(requestedModel)) {
      await recordUsage(req.apiKeyId, 403, {});
      return res.status(403).json({
        error: { message: `Model ${requestedModel} is not available for this account`, type: 'permission_error', code: 'model_not_entitled' },
      });
    }
    if (!snapshot.router_credential) {
      const error = new Error('router_access_not_provisioned');
      error.status = 503;
      throw error;
    }

    const upstream = await axios.post(`${routerBaseUrl()}/chat/completions`, req.body, {
      responseType: req.body?.stream ? 'stream' : 'json',
      timeout: 120000,
      headers: {
        Authorization: `Bearer ${snapshot.router_credential}`,
        'Content-Type': 'application/json',
        Accept: req.body?.stream ? 'text/event-stream' : 'application/json',
        ...(req.headers['x-request-id'] ? { 'X-Request-ID': req.headers['x-request-id'] } : {}),
      },
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      await recordUsage(req.apiKeyId, upstream.status, extractUsage(upstream.data));
      if (upstream.data?.pipe) upstream.data.resume();
      return sendUpstreamError(res, { response: { status: upstream.status, data: upstream.data } });
    }

    if (req.body?.stream && upstream.data?.pipe) {
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      let buffer = '';
      upstream.data.on('data', (chunk) => {
        if (buffer.length < 256000) buffer += chunk.toString('utf8');
        res.write(chunk);
      });
      upstream.data.on('end', async () => {
        let usage = {};
        for (const line of buffer.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            if (parsed?.usage) usage = extractUsage(parsed);
          } catch (_) {
            // Keep forwarding SSE events even when a provider emits non-JSON data.
          }
        }
        await recordUsage(req.apiKeyId, upstream.status, usage);
        res.end();
      });
      upstream.data.on('error', async (error) => {
        await recordUsage(req.apiKeyId, 502, {});
        if (!res.headersSent) return res.status(502).json({ error: { message: error.message, type: 'upstream_error' } });
        res.end();
      });
      return undefined;
    }

    await recordUsage(req.apiKeyId, upstream.status, extractUsage(upstream.data));
    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    await recordUsage(req.apiKeyId, error.response?.status || error.status || 502, {});
    logger.error('[BPApi] Chat completion failed', { error: error.message, userId: req.user?.id });
    return sendUpstreamError(res, error);
  }
});

module.exports = router;
