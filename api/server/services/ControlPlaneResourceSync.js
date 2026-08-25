const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const db = require('~/models');
const { redact } = require('./ControlPlaneAssetSync');

async function resolveEmail(req, userId) {
  if (typeof req.user?.email === 'string' && req.user.email.trim()) return req.user.email.trim();
  try {
    const user = await db.findUser({ _id: userId }, 'email');
    return typeof user?.email === 'string' ? user.email.trim() : '';
  } catch (error) {
    logger.warn('[ResourceSync] Failed to resolve user email', { message: error.message });
    return '';
  }
}

/**
 * Best-effort metadata-only file/artifact inventory sync.
 * Content, URLs, storage paths and credentials never leave BP Chat.
 */
async function syncResourceToControlPlane({ req, resourceType, resource, externalId, deleted = false }) {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  const userId = String(req.user?.id || req.user?._id || '');
  const item = typeof resource?.toObject === 'function' ? resource.toObject() : resource || {};
  const id = String(externalId || item.file_id || item.messageId || item._id || '');
  if (!controlPlaneUrl || !internalServiceToken || !userId || !resourceType || !id) return false;
  const email = await resolveEmail(req, userId);
  if (!email) return false;
  const safeMetadata = redact({
    context: item.context,
    source: item.source,
    width: item.width,
    height: item.height,
    embedded: item.embedded,
    artifact_index: item.artifact_index,
  }) || {};
  const payload = {
    external_user_id: userId,
    email,
    external_id: id,
    resource_type: resourceType,
    name: String(item.filename || item.name || item.title || id).slice(0, 255),
    mime_type: String(item.type || item.mime_type || '').slice(0, 160),
    size_bytes: Number(item.bytes || item.size || 0),
    conversation_external_id: String(item.conversationId || item.conversation_id || req.body?.conversationId || '').slice(0, 160),
    status: deleted ? 'deleted' : String(item.status || 'active'),
    metadata: safeMetadata,
    deleted: Boolean(deleted),
  };
  try {
    await axios.post(
      `${controlPlaneUrl.replace(/\/$/, '')}/api/platform/internal/resources/sync/`,
      payload,
      { timeout: 3000, headers: { 'X-BP-Internal-Token': internalServiceToken } },
    );
    return true;
  } catch (error) {
    logger.warn('[ResourceSync] Operator inventory synchronization failed', {
      resourceType,
      externalId: id,
      status: error.response?.status,
      message: error.message,
    });
    return false;
  }
}

function extractArtifactInventory(message) {
  const chunks = [];
  if (typeof message?.text === 'string') chunks.push(message.text);
  for (const part of Array.isArray(message?.content) ? message.content : []) {
    if (part?.type === 'text' && typeof part.text === 'string') chunks.push(part.text);
  }

  const artifacts = [];
  const declaration = /:::artifact\{([^}]*)\}/g;
  for (const chunk of chunks) {
    let match;
    while ((match = declaration.exec(chunk)) !== null) {
      const attributes = match[1];
      const readAttribute = (name) =>
        attributes.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1]?.trim() || '';
      artifacts.push({
        identifier: readAttribute('identifier') || readAttribute('id'),
        title: readAttribute('title'),
        type: readAttribute('type') || 'text/plain',
      });
    }
  }
  return artifacts;
}

/**
 * Project generated artifacts to the operator inventory as metadata as soon as
 * a response is durably saved. Artifact source code/content is intentionally
 * excluded from the projection.
 */
async function syncMessageArtifactsToControlPlane({ req, message }) {
  const messageId = String(message?.messageId || message?._id || '');
  if (!messageId) return [];
  const artifacts = extractArtifactInventory(message);
  return Promise.all(
    artifacts.map((artifact, index) =>
      syncResourceToControlPlane({
        req,
        resourceType: 'artifact',
        externalId: `${messageId}:${artifact.identifier || index}`,
        resource: {
          messageId,
          conversationId: message.conversationId,
          title: artifact.title || artifact.identifier || `Artifact ${index + 1}`,
          type: artifact.type,
          artifact_index: index,
          source: 'artifact',
        },
      }),
    ),
  );
}

module.exports = {
  syncResourceToControlPlane,
  syncMessageArtifactsToControlPlane,
  extractArtifactInventory,
};
