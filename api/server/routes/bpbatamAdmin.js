const express = require('express');
const { createGovernanceDelegation, createGovernanceMutationJournal } = require('@librechat/api');
const db = require('~/models');
const { createGovernanceCommandStore, encryptV2, decryptV2 } = require('@librechat/data-schemas');
const router = express.Router();
router.use(createGovernanceDelegation({ findUsers: db.findUsers, audit: db.recordAuditEntry }));
router.use(
  createGovernanceMutationJournal({
    store: createGovernanceCommandStore(require('mongoose')),
    encrypt: encryptV2,
    decrypt: decryptV2,
  }),
);
for (const [path, source] of Object.entries({
  config: 'config',
  groups: 'groups',
  roles: 'roles',
  grants: 'grants',
  skills: 'skills',
  langfuse: 'langfuse',
  'code-environments': 'code',
  'audit-log': 'audit',
  users: 'users',
})) {
  router.use('/' + path, require('./admin/' + source));
}
module.exports = router;
