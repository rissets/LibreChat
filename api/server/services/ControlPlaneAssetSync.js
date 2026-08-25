const axios = require('axios');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const db = require('~/models');

/**
 * Send a redacted lifecycle projection to the operator control plane.
 *
 * BP Chat remains the source of truth for the native resource, permissions,
 * files and credentials. The control plane stores only enough metadata for
 * ownership, assignment, publication and monitoring. Sync is deliberately
 * best-effort so a control-plane restart cannot break resource creation in
 * the chat experience.
 */
const SECRET_KEY = /(secret|token|password|credential|apikey|api_key|private|authorization|cookie|session|headers)/i;
const MAX_STRING_LENGTH = 100000;

function redact(value, key = '') {
  if (SECRET_KEY.test(String(key))) return undefined;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, key)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([childKey, childValue]) => [childKey, redact(childValue, childKey)])
        .filter(([, childValue]) => childValue !== undefined),
    );
  }
  return undefined;
}

function plainAsset(asset) {
  if (!asset) return {};
  if (typeof asset.toObject === 'function') return asset.toObject();
  return asset;
}

async function resolveUserEmail(req, externalUserId) {
  const direct = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  if (direct) return direct;
  if (!externalUserId) return '';
  try {
    const persisted = await db.findUser({ _id: externalUserId }, 'email');
    return typeof persisted?.email === 'string' ? persisted.email.trim() : '';
  } catch (error) {
    logger.warn('[AssetSync] Failed to resolve authenticated user email', {
      externalUserId,
      message: error.message,
    });
    return '';
  }
}

function buildConfiguration(assetType, asset) {
  const item = plainAsset(asset);
  if (assetType === 'agent') {
    return redact({
      model: item.model,
      provider: item.provider,
      model_parameters: item.model_parameters,
      category: item.category,
      support_contact: item.support_contact,
      recursion_limit: item.recursion_limit,
      conversation_starters: item.conversation_starters,
      tools: item.tools,
      actions: item.actions,
      skills: item.skills,
      skills_enabled: item.skills_enabled,
      mcpServerNames: item.mcpServerNames,
      subagents: item.subagents,
      artifacts: item.artifacts,
      tool_resources: item.tool_resources,
      tool_options: item.tool_options,
      stateful_code_sessions: item.stateful_code_sessions,
      hide_sequential_outputs: item.hide_sequential_outputs,
      end_after_tools: item.end_after_tools,
      memory_scope: item.memory_scope,
      edges: item.edges,
    }) || {};
  }
  if (assetType === 'skill') {
    return redact({
      name: item.name,
      displayTitle: item.displayTitle,
      category: item.category,
      alwaysApply: item.alwaysApply,
      userInvocable: item.userInvocable,
      disableModelInvocation: item.disableModelInvocation,
      allowedTools: item.allowedTools,
      frontmatter: item.frontmatter,
      sourceMetadata: item.sourceMetadata,
    }) || {};
  }
  if (assetType === 'tool') {
    return redact({
      metadata: item.metadata,
      functions: item.functions,
      agent_id: item.agent_id,
      tool_name: item.tool_name || item.metadata?.name,
    }) || {};
  }
  return redact(item.config || item.configuration || {}) || {};
}

async function syncAssetToControlPlane({ req, assetType, externalId, asset, deleted = false }) {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const externalUserId = String(req.user?.id || req.user?._id || '');
  if (!controlPlaneUrl || !internalServiceToken || !assetType || !externalId || !externalUserId) {
    logger.warn('[AssetSync] Operator catalog synchronization skipped', {
      assetType,
      externalId,
      reason: 'control-plane-not-configured-or-identity-missing',
    });
    return false;
  }

  const item = plainAsset(asset);
  const email = await resolveUserEmail(req, externalUserId);
  if (!email) {
    logger.warn('[AssetSync] Operator catalog synchronization skipped', {
      assetType,
      externalId,
      externalUserId,
      reason: 'authenticated-email-missing',
    });
    return false;
  }

  const payload = {
    asset_type: assetType,
    external_user_id: externalUserId,
    email,
    external_id: String(externalId),
    name: String(item.name || item.displayTitle || item.metadata?.name || externalId),
    description: String(item.description || item.metadata?.description || ''),
    instructions: String(item.instructions || item.body || ''),
    configuration: buildConfiguration(assetType, item),
    deleted: Boolean(deleted),
    published: false,
  };

  try {
    await axios.post(
      `${controlPlaneUrl.replace(/\/$/, '')}/api/platform/internal/assets/sync/`,
      payload,
      { timeout: 3000, headers: { 'X-BP-Internal-Token': internalServiceToken } },
    );
    return true;
  } catch (error) {
    logger.warn('[AssetSync] Operator catalog synchronization failed', {
      assetType,
      externalId,
      status: error.response?.status,
      message: error.message,
    });
    return false;
  }
}

/**
 * Repair the operator projection for assets that were created before the
 * lifecycle hooks were enabled (or while the control plane was restarting).
 * This is intentionally owner-scoped and never mirrors operator-managed
 * projections back into the catalog, which prevents sync loops and duplicate
 * rows. The payload is metadata-only and is redacted by the normal sync path.
 */
async function syncOwnedAssetsToControlPlane(req) {
  const userId = String(req.user?.id || req.user?._id || '');
  if (!userId) return { skills: 0, agents: 0, tools: 0 };

  const result = { skills: 0, agents: 0, tools: 0 };
  const Skill = mongoose.models.Skill;
  if (Skill) {
    const skills = await Skill.find({
      author: userId,
      'frontmatter._bpManaged': { $ne: true },
    }).lean().exec();
    for (const skill of skills) {
      const synced = await syncAssetToControlPlane({
        req,
        assetType: 'skill',
        externalId: String(skill._id),
        asset: skill,
      });
      if (synced) result.skills += 1;
    }
  }

  const agents = typeof db.getAgents === 'function'
    ? await db.getAgents({ author: userId })
    : [];
  const ownedAgents = (agents || []).filter((agent) => {
    const id = String(agent?.id || agent?._id || '');
    return id && !id.startsWith('agent_bp_');
  });
  for (const agent of ownedAgents) {
    const synced = await syncAssetToControlPlane({
      req,
      assetType: 'agent',
      externalId: String(agent.id || agent._id),
      asset: agent,
    });
    if (synced) result.agents += 1;
  }

  const agentIds = ownedAgents.map((agent) => String(agent.id || agent._id));
  if (agentIds.length && typeof db.getActions === 'function') {
    const actions = await db.getActions({ agent_id: { $in: agentIds } });
    for (const action of actions || []) {
      const metadata = action.metadata || {};
      const name = metadata.name || action.action_id || 'BP Chat action';
      const synced = await syncAssetToControlPlane({
        req,
        assetType: 'tool',
        externalId: String(action.action_id || action._id),
        asset: {
          ...action,
          name,
          description: metadata.description || '',
          tool_name: name,
          agent_id: action.agent_id,
        },
      });
      if (synced) result.tools += 1;
    }
  }

  return result;
}

module.exports = {
  syncAssetToControlPlane,
  syncOwnedAssetsToControlPlane,
  redact,
  buildConfiguration,
};
