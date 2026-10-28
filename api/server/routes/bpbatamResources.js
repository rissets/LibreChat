const express = require('express');
const mongoose = require('mongoose');
const {
  createGovernanceResources,
  createGovernanceDispatcher,
  createGovernanceResourceInvalidator,
} = require('@librechat/api');
const {
  createGovernanceRepository,
  createGovernanceCommandStore,
  encryptV2,
  decryptV2,
} = require('@librechat/data-schemas');
const db = require('~/models');
const { invalidateConfigCaches, invalidateCachedTools } = require('~/server/services/Config');
const { getMCPManager, getMCPServersRegistry } = require('~/config');
const configMiddleware = require('~/server/middleware/config/app');
const { CacheKeys } = require('librechat-data-provider');
const { getLogStores } = require('~/cache');
const router = express.Router();
router.use(
  createGovernanceResources({
    repository: createGovernanceRepository(mongoose, {
      getUserPrincipals: db.getUserPrincipals,
      upsertGroupByExternalId: db.upsertGroupByExternalId,
      grantPermission: db.grantPermission,
      deleteAclEntries: db.deleteAclEntries,
      findAccessibleResources: db.findAccessibleResources,
    }),
    journal: {
      store: createGovernanceCommandStore(mongoose),
      encrypt: encryptV2,
      decrypt: decryptV2,
    },
    getUserById: db.getUserById,
    audit: db.recordAuditEntry,
    invalidate: createGovernanceResourceInvalidator({
      config: invalidateConfigCaches,
      mcp: {
        registry: getMCPServersRegistry,
        fence: invalidateCachedTools,
        manager: getMCPManager,
      },
      linkedCache: getLogStores(CacheKeys.AGENT_LINKED_INSTRUCTIONS),
    }),
    dispatch: createGovernanceDispatcher({
      configure: configMiddleware,
      load: (route) => require('./' + route),
      loadUpload: () => require('./files').initialize(),
    }),
  }),
);
module.exports = router;
