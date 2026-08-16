const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  ResourceType,
  AccessRoleIds,
  PrincipalType,
} = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const { grantPermission } = require('~/server/services/PermissionService');
const db = require('~/models');

const router = express.Router();
const MANAGED_AGENT_PREFIX = 'agent_bp_';
const DEFAULT_AGENT_MODEL = 'bp/gpt-5.6-sol-medium';
const NATIVE_AGENT_TOOLS = new Set([
  'image_gen_oai',
  'execute_code',
  'file_search',
  'web_search',
  'memory',
]);

function managedAgentId(userId, assetId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${String(userId)}:${String(assetId)}`)
    .digest('hex')
    .slice(0, 24);
  return `${MANAGED_AGENT_PREFIX}${digest}`;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Materialize operator-managed agents into the signed-in user's native agent
 * catalog.  The operator plane remains authoritative; deterministic IDs make
 * the operation idempotent and stale assignments are removed on the next
 * access refresh.
 */
async function syncManagedAgents(snapshot, user) {
  const userId = String(user?.id || user?._id || '');
  if (!userId) {
    return snapshot;
  }

  const assets = Array.isArray(snapshot?.managed_assets) ? snapshot.managed_assets : [];
  const agents = assets.filter((asset) => asset?.type === 'agent');
  const assignedToolNames = assets
    .filter((asset) => asset?.type === 'tool')
    .map((asset) => asset?.configuration?.tool_name)
    .filter((tool) => NATIVE_AGENT_TOOLS.has(tool));
  const hasSkills = assets.some((asset) => asset?.type === 'skill');
  const expectedIds = new Set();
  const runtimeIds = new Map();

  for (const asset of agents) {
    const id = managedAgentId(userId, asset.id);
    expectedIds.add(id);
    runtimeIds.set(String(asset.id), id);
    const config = asset.configuration && typeof asset.configuration === 'object'
      ? asset.configuration
      : {};
    const configuredTools = stringList(config.tools);
    const requestedTools = configuredTools.length ? configuredTools : assignedToolNames;
    const tools = [...new Set(requestedTools.filter((tool) => NATIVE_AGENT_TOOLS.has(tool)))];
    const artifacts = config.artifacts || (requestedTools.includes('artifacts') ? 'default' : undefined);
    const subagentsEnabled = requestedTools.includes('subagents');
    const agentData = {
      name: asset.name || 'Asisten BP Batam',
      description: asset.description || config.description || '',
      instructions:
        asset.instructions ||
        'Anda adalah asisten kerja BP Batam. Gunakan kemampuan yang tersedia hanya ketika relevan, verifikasi hasil tool, lindungi data internal, dan jawab dalam Bahasa Indonesia yang jelas.',
      provider: 'BP Batam AI',
      model: asset.model || config.model || DEFAULT_AGENT_MODEL,
      model_parameters: { useResponsesApi: false },
      category: config.category || 'BP Batam',
      conversation_starters: stringList(config.conversation_starters),
      tools,
      skills: [],
      skills_enabled: hasSkills,
      artifacts,
      subagents: subagentsEnabled
        ? { enabled: true, allowSelf: true, agent_ids: [] }
        : { enabled: false, allowSelf: false, agent_ids: [] },
      tool_resources: {},
      edges: [],
    };

    let agent = await db.getAgent({ id, author: userId });
    if (agent) {
      agent = await db.updateAgent({ id, author: userId }, agentData, { updatingUserId: userId });
    } else {
      agent = await db.createAgent({ id, author: userId, ...agentData });
    }

    await Promise.all([
      grantPermission({
        principalType: PrincipalType.USER,
        principalId: userId,
        resourceType: ResourceType.AGENT,
        resourceId: agent._id,
        accessRoleId: AccessRoleIds.AGENT_OWNER,
        grantedBy: userId,
      }),
      grantPermission({
        principalType: PrincipalType.USER,
        principalId: userId,
        resourceType: ResourceType.REMOTE_AGENT,
        resourceId: agent._id,
        accessRoleId: AccessRoleIds.REMOTE_AGENT_OWNER,
        grantedBy: userId,
      }),
    ]);
  }

  const staleAgents = await db.getAgents({
    author: userId,
    id: { $regex: `^${MANAGED_AGENT_PREFIX}` },
  });
  await Promise.all(
    staleAgents
      .filter((agent) => !expectedIds.has(agent.id))
      .map((agent) => db.deleteAgent({ id: agent.id, author: userId })),
  );

  return {
    ...snapshot,
    managed_assets: assets.map((asset) =>
      asset?.type === 'agent'
        ? { ...asset, runtime_agent_id: runtimeIds.get(String(asset.id)) }
        : asset,
    ),
  };
}

/**
 * Read the signed-in user's operator-managed access snapshot.  This route is
 * intentionally a thin identity/session adapter: model enforcement remains in
 * the private AI source and no router credential is ever returned to the web
 * client.
 */
router.get('/', requireJwtAuth, async (req, res) => {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const email = req.user?.email;

  if (!controlPlaneUrl || !internalServiceToken) {
    return res.status(503).json({ detail: 'access_service_not_configured' });
  }
  if (!email) {
    return res.status(422).json({ detail: 'authenticated_user_email_required' });
  }

  const baseURL = controlPlaneUrl.replace(/\/$/, '');
  const headers = { 'X-BP-Internal-Token': internalServiceToken };

  try {
    const response = await axios.post(
      `${baseURL}/api/platform/internal/identity/resolve/`,
      { email, external_user_id: String(req.user?.id || req.user?._id || '') },
      { timeout: 5000, headers },
    );

    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = String(
      Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.ip || '',
    )
      .split(',')[0]
      .trim()
      .replace(/^::ffff:/, '');

    await axios
      .post(
        `${baseURL}/api/platform/internal/session/touch/`,
        {
          email,
          external_user_id: String(req.user?.id || req.user?._id || ''),
          session_key: String(req.sessionID || req.user?.id || req.user?._id || 'unknown').slice(
            0,
            128,
          ),
          device_name: 'BP Chat Web',
          user_agent: req.headers['user-agent'] || '',
          ip_address: ipAddress || null,
        },
        { timeout: 3000, headers },
      )
      .catch((error) => {
        logger.warn('[BPAccess] Session synchronization failed', {
          status: error.response?.status,
          userId: req.user?.id ?? req.user?._id,
        });
      });

    const safeSnapshot = await syncManagedAgents({ ...(response.data || {}) }, req.user).catch(
      (error) => {
        logger.error('[BPAccess] Managed agent synchronization failed', {
          userId: req.user?.id ?? req.user?._id,
          error: error.message,
        });
        return { ...(response.data || {}), agent_sync_status: 'error' };
      },
    );
    delete safeSnapshot.router_credential;
    delete safeSnapshot.router_key_id;
    return res.status(200).json(safeSnapshot);
  } catch (error) {
    const status = error.response?.status;
    logger.error('[BPAccess] Access snapshot failed', {
      status,
      userId: req.user?.id ?? req.user?._id,
    });
    return res.status(status === 404 ? 404 : 502).json({
      detail: status === 404 ? 'identity_not_found' : 'access_service_unavailable',
    });
  }
});

module.exports = router;
