const express = require('express');
const { createApiKeyHandlers } = require('@librechat/api');
const {
  getAgentApiKeyById,
  createAgentApiKey,
  deleteAgentApiKey,
  listAgentApiKeys,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const handlers = createApiKeyHandlers({
  createAgentApiKey,
  listAgentApiKeys,
  deleteAgentApiKey,
  getAgentApiKeyById,
});

// These are BP Chat user credentials, not a remote-agent-only feature. The
// public BP API still applies the user's source-backed model and quota policy.
router.post('/', requireJwtAuth, handlers.createApiKey);

router.get('/', requireJwtAuth, handlers.listApiKeys);

router.get('/:id', requireJwtAuth, handlers.getApiKey);

router.delete('/:id', requireJwtAuth, handlers.deleteApiKey);

module.exports = router;
