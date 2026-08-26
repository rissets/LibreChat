const { Readable } = require('stream');
const { FileSources } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');

/**
 * Images generated during an agent run are uploaded to the same user-scoped
 * Code Interpreter bucket as regular attachments. The agents package keeps
 * the sandbox context in memory, so this small process-local registry bridges
 * an image tool call to a following execute_code call in the same run.
 *
 * The registry is intentionally short lived and contains only opaque storage
 * refs (never image bytes or credentials). A later turn is also covered by
 * the persisted `metadata.codeEnvRef` on the generated file record.
 */
const REGISTRY_KEY = '__hellodigi_code_image_registry__';
const REGISTRY_TTL_MS = 10 * 60 * 1000;

function getRegistry() {
  const root = globalThis;
  if (!root[REGISTRY_KEY]) {
    root[REGISTRY_KEY] = new Map();
  }
  return root[REGISTRY_KEY];
}

function cleanupRegistry(registry, now = Date.now()) {
  for (const [key, value] of registry.entries()) {
    if (!value || value.expiresAt <= now) {
      registry.delete(key);
    }
  }
}

function getRuntimeKeys(runnableConfig) {
  const configurable = runnableConfig?.configurable ?? {};
  const toolCall = runnableConfig?.toolCall ?? {};
  return [
    toolCall._runtime_session_hint,
    configurable.runtimeSessionHint,
    configurable.thread_id,
    configurable.requestBody?.conversationId,
  ].filter((key) => typeof key === 'string' && key.length > 0);
}

/**
 * Upload a generated image to Code Interpreter and register its ref for the
 * current run. Failure is best effort: the normal inline image attachment is
 * still rendered even when the sandbox service is unavailable.
 */
async function registerGeneratedImage({ req, runnableConfig, buffer, filename }) {
  if (!req?.user?.id || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  try {
    const { handleFileUpload } = getStrategyFunctions(FileSources.execute_code);
    if (typeof handleFileUpload !== 'function') {
      return null;
    }

    const uploaded = await handleFileUpload({
      req,
      stream: Readable.from(buffer),
      filename,
      kind: 'user',
      id: req.user.id,
    });

    if (!uploaded?.storage_session_id || !uploaded?.file_id) {
      return null;
    }

    const ref = {
      id: uploaded.file_id,
      resource_id: req.user.id,
      storage_session_id: uploaded.storage_session_id,
      name: filename,
      kind: 'user',
    };
    const entry = {
      session_id: uploaded.storage_session_id,
      files: [ref],
      expiresAt: Date.now() + REGISTRY_TTL_MS,
    };
    const registry = getRegistry();
    cleanupRegistry(registry);
    const keys = getRuntimeKeys(runnableConfig);
    for (const key of keys) {
      const previous = registry.get(key);
      registry.set(key, {
        session_id: entry.session_id,
        files: [...(previous?.files ?? []), ref],
        expiresAt: entry.expiresAt,
      });
    }
    return {
      kind: 'user',
      id: req.user.id,
      storage_session_id: uploaded.storage_session_id,
      file_id: uploaded.file_id,
    };
  } catch (error) {
    logger.warn('[ImageGen] Code Interpreter image handoff unavailable', {
      message: error?.message ?? String(error),
    });
    return null;
  }
}

function getRegisteredGeneratedImages(keys = []) {
  const registry = getRegistry();
  cleanupRegistry(registry);
  for (const key of keys) {
    const entry = registry.get(key);
    if (entry?.files?.length) {
      return entry;
    }
  }
  return null;
}

module.exports = {
  REGISTRY_KEY,
  getRuntimeKeys,
  getRegisteredGeneratedImages,
  registerGeneratedImage,
};
