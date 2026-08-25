const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  ResourceType,
  AccessRoleIds,
  PrincipalType,
} = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const { grantPermission } = require('~/server/services/PermissionService');
const db = require('~/models');
const { syncOwnedAssetsToControlPlane } = require('~/server/services/ControlPlaneAssetSync');
const { reconcileOwnedMCPServers } = require('~/server/controllers/mcp');

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

function slugifySkillName(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return slug || 'managed-skill';
}

/**
 * Keep operator-managed skills readable in the native chat UI. Global catalog
 * skills keep their stable public name; private/department projections get a
 * short deterministic suffix so two assets with the same display title do not
 * collide for a user.
 */
function managedSkillName(asset) {
  const config = asset?.configuration && typeof asset.configuration === 'object'
    ? asset.configuration
    : {};
  const raw = config.skill_name || config.name || config.displayTitle || asset?.name || asset?.external_id || 'managed-skill';
  const base = slugifySkillName(raw);
  const sourceId = String(asset?.source_id || asset?.id || '');
  if (sourceId.startsWith('global:skill:')) return base;
  const suffix = crypto.createHash('sha256').update(sourceId).digest('hex').slice(0, 8);
  return `${base}-${suffix}`.slice(0, 80);
}

async function findManagedSkillBySource({ sourceId, userId, tenantId }) {
  const Skill = mongoose.models.Skill;
  if (!Skill || !sourceId || !userId) return null;
  const query = {
    author: userId,
    'frontmatter._bpManaged': true,
    'frontmatter._bpSourceId': sourceId,
  };
  if (tenantId) query.tenantId = tenantId;
  return Skill.findOne(query).exec();
}

/** Materialize operator-published/assigned skills into the native skill catalog. */
async function syncManagedSkills(snapshot, user) {
  const userId = String(user?.id || user?._id || '');
  if (!userId) return { snapshot, skillIds: [] };
  const assets = Array.isArray(snapshot?.managed_assets) ? snapshot.managed_assets : [];
  const skills = assets.filter((asset) => asset?.type === 'skill');
  const runtimeIds = new Map();

  for (const asset of skills) {
    const config = asset.configuration && typeof asset.configuration === 'object' ? asset.configuration : {};
    const sourceId = String(asset.source_id || `bp-control-plane:skill:${asset.id}`);
    const name = managedSkillName(asset);
    const body = asset.instructions || `# ${asset.name || 'BP Batam skill'}\n\n${asset.description || ''}`;
    const frontmatter = {
      ...(config.frontmatter && typeof config.frontmatter === 'object' ? config.frontmatter : {}),
      _bpManaged: true,
      _bpSourceId: sourceId,
    };
    let skill = typeof db.getAuthorSkillByName === 'function'
      ? await db.getAuthorSkillByName({ name, author: userId, tenantId: user?.tenantId })
      : null;
    // Older projections used a UUID-like `bp-...` name. Resolve by immutable
    // source ID as a migration path so the same native record is renamed,
    // rather than creating a duplicate on every refresh.
    if (!skill) {
      skill = await findManagedSkillBySource({
        sourceId,
        userId,
        tenantId: user?.tenantId,
      });
    }
    const skillData = {
      name,
      displayTitle: config.displayTitle || asset.name || name,
      description: asset.description || `Skill terkelola BP Batam: ${asset.name || name}`,
      body,
      frontmatter,
      // Keep the native category vocabulary used by the chat agent editor.
      // A branding label here creates a category that the client cannot edit
      // consistently and makes operator-created agents diverge from user ones.
      category: config.category || 'general',
      alwaysApply: Boolean(config.alwaysApply),
      userInvocable: config.userInvocable !== false,
      disableModelInvocation: Boolean(config.disableModelInvocation),
      allowedTools: stringList(config.allowedTools),
      sourceMetadata:
        config.sourceMetadata && typeof config.sourceMetadata === 'object'
          ? config.sourceMetadata
          : undefined,
    };
    try {
      if (skill && typeof db.updateSkill === 'function') {
        // Access refreshes run on every authenticated request. Do not bump
        // the native skill version when the operator projection is unchanged;
        // otherwise concurrent chat requests continually create conflicts and
        // make the managed skill appear to churn in the user catalog.
        const current = {
          name: skill.name,
          displayTitle: skill.displayTitle,
          description: skill.description,
          body: skill.body,
          frontmatter: skill.frontmatter,
          category: skill.category,
          alwaysApply: Boolean(skill.alwaysApply),
          userInvocable: skill.userInvocable !== false,
        };
        const desired = { ...skillData, frontmatter };
        const changed = Object.keys(desired).some((key) =>
          JSON.stringify(current[key]) !== JSON.stringify(desired[key]),
        );
        if (changed) {
          const updated = await db.updateSkill({
            id: String(skill._id),
            expectedVersion: Number(skill.version || 1),
            update: skillData,
          });
          if (updated?.status === 'updated' && updated.skill) skill = updated.skill;
        }
      } else if (!skill && typeof db.createSkill === 'function') {
        const created = await db.createSkill({ ...skillData, author: userId, authorName: user?.name || user?.username || 'BP Batam AI', tenantId: user?.tenantId });
        skill = created?.skill || created;
      }
      if (!skill?._id) continue;
      runtimeIds.set(String(asset.id), String(skill._id));
      await grantPermission({
        principalType: PrincipalType.USER,
        principalId: userId,
        resourceType: ResourceType.SKILL,
        resourceId: skill._id,
        accessRoleId: AccessRoleIds.SKILL_OWNER,
        grantedBy: userId,
      });
    } catch (error) {
      // A stale version or a transient Mongo error must not block login/access.
      logger.warn('[BPAccess] Managed skill synchronization failed', {
        userId,
        assetId: String(asset.id),
        message: error.message,
      });
    }
  }

  // Remove stale managed projections only after a valid non-empty snapshot.
  // User-created skills are never touched because they do not carry the
  // `_bpManaged` marker and source ID.
  if (skills.length > 0 && mongoose.models.Skill) {
    const expectedSources = new Set(
      skills.map((asset) => String(asset.source_id || `bp-control-plane:skill:${asset.id}`)),
    );
    const managed = await mongoose.models.Skill.find({
      author: userId,
      'frontmatter._bpManaged': true,
    }).exec();
    await Promise.all(
      managed
        .filter((skill) => {
          const sourceId = String(skill?.frontmatter?._bpSourceId || '');
          return sourceId && !expectedSources.has(sourceId);
        })
        .map(async (skill) => {
          try {
            if (typeof db.deleteSkill === 'function') await db.deleteSkill(String(skill._id));
          } catch (error) {
            logger.warn('[BPAccess] Stale managed skill cleanup failed', {
              userId,
              skillId: String(skill._id),
              message: error.message,
            });
          }
        }),
    );
  }

  return {
    snapshot: {
      ...snapshot,
      managed_assets: assets.map((asset) =>
        asset?.type === 'skill'
          ? {
              ...asset,
              runtime_skill_id: runtimeIds.get(String(asset.id)),
              runtime_skill_name: managedSkillName(asset),
            }
          : asset,
      ),
    },
    skillIds: [...runtimeIds.values()],
  };
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
  const managedSkills = assets.filter(
    (asset) => asset?.type === 'skill' && asset?.runtime_skill_id,
  );
  const managedSkillIds = managedSkills.map((asset) => String(asset.runtime_skill_id));
  const managedSkillAliases = new Map();
  for (const asset of managedSkills) {
    const runtimeId = String(asset.runtime_skill_id);
    const config = asset.configuration && typeof asset.configuration === 'object'
      ? asset.configuration
      : {};
    [asset.id, asset.name, asset.external_id, asset.source_id, asset.runtime_skill_name,
      config.name, config.displayTitle]
      .filter(Boolean)
      .forEach((alias) => managedSkillAliases.set(String(alias), runtimeId));
  }
  const managedMCPNames = new Map();
  for (const asset of assets.filter(
    (item) => item?.type === 'mcp' && item?.runtime_server_name,
  )) {
    const runtimeName = String(asset.runtime_server_name);
    const config = asset.configuration && typeof asset.configuration === 'object'
      ? asset.configuration
      : {};
    [asset.id, asset.name, asset.external_id, asset.source_id, runtimeName,
      config.server_name, config.title]
      .filter(Boolean)
      .forEach((alias) => managedMCPNames.set(String(alias), runtimeName));
  }
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
    // Action references are stored separately from native capability names in
    // LibreChat. Preserve them so operator-managed agents keep their custom
    // action executors after materialization.
    const actions = [...new Set(stringList(config.actions))];
    const artifacts = config.artifacts || (requestedTools.includes('artifacts') ? 'default' : undefined);
    const configuredSubagents = config.subagents && typeof config.subagents === 'object'
      ? config.subagents
      : null;
    const subagentsEnabled = requestedTools.includes('subagents') || Boolean(configuredSubagents?.enabled);
    const configuredMCPs = stringList(config.mcpServerNames);
    const mcpServerNames = [...new Set(configuredMCPs.map((name) => managedMCPNames.get(name) || name))];
    const configuredSkills = stringList(config.skills);
    const selectedSkillIds = configuredSkills.length
      ? [...new Set(configuredSkills.map((name) => managedSkillAliases.get(name)).filter(Boolean))]
      : managedSkillIds;
    const agentData = {
      name: asset.name || 'Asisten BP Batam',
      description: asset.description || config.description || '',
      instructions:
        asset.instructions ||
        'Anda adalah asisten kerja BP Batam. Gunakan kemampuan yang tersedia hanya ketika relevan, verifikasi hasil tool, lindungi data internal, dan jawab dalam Bahasa Indonesia yang jelas.',
      provider: 'BP Batam AI',
      model: asset.model || config.model || DEFAULT_AGENT_MODEL,
      model_parameters: {
        ...(config.model_parameters && typeof config.model_parameters === 'object'
          ? config.model_parameters
          : {}),
        useResponsesApi: false,
      },
      category: config.category || 'general',
      support_contact: config.support_contact || undefined,
      recursion_limit: Number(config.recursion_limit || 25),
      conversation_starters: stringList(config.conversation_starters),
      tools,
      actions,
      skills: selectedSkillIds,
      skills_enabled: config.skills_enabled !== false && selectedSkillIds.length > 0,
      artifacts,
      subagents: subagentsEnabled
        ? { enabled: true, allowSelf: true, agent_ids: [], ...(configuredSubagents || {}) }
        : { enabled: false, allowSelf: false, agent_ids: [] },
      mcpServerNames,
      tool_resources:
        config.tool_resources && typeof config.tool_resources === 'object'
          ? config.tool_resources
          : {},
      tool_options:
        config.tool_options && typeof config.tool_options === 'object'
          ? config.tool_options
          : {},
      stateful_code_sessions: Boolean(config.stateful_code_sessions),
      hide_sequential_outputs: Boolean(config.hide_sequential_outputs),
      end_after_tools: Boolean(config.end_after_tools),
      memory_scope: ['user', 'agent'].includes(config.memory_scope) ? config.memory_scope : undefined,
      edges: Array.isArray(config.edges) ? config.edges : [],
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

/** Materialize MCPs explicitly published by an operator for this user. */
async function syncManagedMCPs(snapshot, user) {
  const userId = String(user?.id || user?._id || '');
  if (!userId) return snapshot;
  const assets = Array.isArray(snapshot?.managed_assets) ? snapshot.managed_assets : [];
  const published = assets.filter((asset) => asset?.type === 'mcp' && asset?.published);
  const existing = await db.findMCPServersByAuthor(userId);
  const expectedSources = new Set();
  const runtimeNames = new Map();

  for (const asset of published) {
    const sourceId = String(asset.source_id || `bp-control-plane:mcp:${asset.id}`);
    expectedSources.add(sourceId);
    const config = asset.configuration && typeof asset.configuration === 'object'
      ? asset.configuration
      : {};
    const managedConfig = {
      ...config,
      title: config.title || asset.name || 'BP Batam connector',
      description: asset.description || config.description || '',
      _bpManaged: true,
      _bpSourceId: sourceId,
    };
    const current = existing.find((server) => server?.config?._bpSourceId === sourceId);
    let server;
    if (current) {
      // Preserve private OAuth/API material that only exists in the user's
      // native record while updating safe metadata from the operator plane.
      server = await db.updateMCPServer(current.serverName, {
        config: { ...(current.config || {}), ...managedConfig },
      });
    } else {
      server = await db.createMCPServer({ config: managedConfig, author: userId });
    }
    if (!server) continue;
    runtimeNames.set(String(asset.id), server.serverName);
    await grantPermission({
      principalType: PrincipalType.USER,
      principalId: userId,
      resourceType: ResourceType.MCPSERVER,
      resourceId: server._id,
      accessRoleId: AccessRoleIds.MCPSERVER_VIEWER,
      grantedBy: userId,
    });
  }

  const stale = existing.filter(
    (server) => server?.config?._bpManaged && !expectedSources.has(server.config?._bpSourceId),
  );
  await Promise.all(stale.map((server) => db.deleteMCPServer(server.serverName)));

  return {
    ...snapshot,
    managed_assets: assets.map((asset) =>
      asset?.type === 'mcp'
        ? { ...asset, runtime_server_name: runtimeNames.get(String(asset.id)) }
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

    // Reconcile user-owned assets on the access handshake as a self-healing
    // path. CRUD hooks remain the fast path, while this catches assets created
    // before synchronization was enabled or during a control-plane restart.
    const ownedAssetSync = await syncOwnedAssetsToControlPlane(req).catch((error) => {
      logger.warn('[BPAccess] User asset reconciliation failed', {
        userId: req.user?.id ?? req.user?._id,
        error: error.message,
      });
      return { skills: 0, agents: 0, tools: 0, status: 'error' };
    });
    await reconcileOwnedMCPServers(req).catch((error) => {
      logger.warn('[BPAccess] User MCP reconciliation failed', {
        userId: req.user?.id ?? req.user?._id,
        error: error.message,
      });
    });

    const skillResult = await syncManagedSkills({ ...(response.data || {}) }, req.user).catch(
      (error) => {
        logger.error('[BPAccess] Managed skill synchronization failed', {
          userId: req.user?.id ?? req.user?._id,
          error: error.message,
        });
        return { snapshot: { ...(response.data || {}), skill_sync_status: 'error' }, skillIds: [] };
      },
    );
    const snapshotWithMCP = await syncManagedMCPs(skillResult.snapshot, req.user).catch((error) => {
      logger.error('[BPAccess] Managed MCP synchronization failed', {
        userId: req.user?.id ?? req.user?._id,
        error: error.message,
      });
      return { ...skillResult.snapshot, mcp_sync_status: 'error' };
    });
    const safeSnapshot = await syncManagedAgents(snapshotWithMCP, req.user).catch(
      (error) => {
        logger.error('[BPAccess] Managed agent synchronization failed', {
          userId: req.user?.id ?? req.user?._id,
          error: error.message,
        });
        return { ...snapshotWithMCP, agent_sync_status: 'error' };
      },
    );
    delete safeSnapshot.router_credential;
    delete safeSnapshot.router_key_id;
    safeSnapshot.user_asset_sync = ownedAssetSync;
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
module.exports.slugifySkillName = slugifySkillName;
module.exports.managedSkillName = managedSkillName;
