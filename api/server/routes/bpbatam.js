const express = require('express');
const { createGatewayBridge, createManagedUserManager } = require('@librechat/api');
const db = require('~/models');
const { createGovernanceEventReader } = require('@librechat/data-schemas');
const router = express.Router();
router.use('/journal', require('@librechat/api').createGovernanceJournalHandler({
  store: require('@librechat/data-schemas').createGovernanceCommandStore(require('mongoose')),
  encrypt: require('@librechat/data-schemas').encryptV2,
  decrypt: require('@librechat/data-schemas').decryptV2,
  audit: db.recordAuditEntry,
}));
router.post('/users/erase',require('@librechat/api').createGovernanceErasure({getUserById:db.getUserById,audit:db.recordAuditEntry,erase:require('~/server/controllers/UserController').deleteUserController}));
router.use('/resources', require('./bpbatamResources'));
router.use(
  createGatewayBridge({
    getRole:db.getRoleByName,
    operationalEvents:createGovernanceEventReader(require('mongoose')),
    manageUser: createManagedUserManager({
      findUsers: db.findUsers,
      getUserById: db.getUserById,
      createUser: db.createUser,
      updateUser: db.updateUser,
      deleteAllUserSessions: db.deleteAllUserSessions,
    }),
    findUsers: db.findUsers,
    getUserById: db.getUserById,
    grantCapability: db.grantCapability,
    recordAuditEntry: db.recordAuditEntry,
  }),
);
module.exports = router;
