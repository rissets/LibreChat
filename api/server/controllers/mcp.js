/**
 * MCP Tools Controller
 * Handles MCP-specific tool endpoints, decoupled from regular LibreChat tools
 *
 * @import { MCPServerRegistry } from '@librechat/api'
 * @import { MCPServerDocument } from 'librechat-data-provider'
 */
const { randomUUID } = require('crypto');
const axios = require('axios');
const { logger, SystemCapabilities } = require('@librechat/data-schemas');
const {
  checkAccess,
  isUserSourced,
  MCPConnection,
  MCPErrorCodes,
  splitMCPToolKey,
  normalizeServerName,
  findShadowedServerNames,
  redactServerSecrets,
  redactAllServerSecrets,
  isMCPDomainNotAllowedError,
  isMCPInspectionFailedError,
  isMCPOAuthSecretReentryRequiredError,
} = require('@librechat/api');
const {
  Constants,
  Permissions,
  ResourceType,
  PermissionBits,
  PermissionTypes,
  MCP_USER_INPUT_FIELDS,
  MCPServerUserInputSchema,
} = require('librechat-data-provider');
const {
  resolveConfigServers,
  resolveMcpConfigNames,
  resolveAllMcpConfigs,
} = require('~/server/services/MCP');
const {
  cacheMCPServerTools,
  getMCPServerTools,
  getMCPToolsCacheGeneration,
  invalidateCachedTools,
} = require('~/server/services/Config');
const { getResourcePermissionsMap } = require('~/server/services/PermissionService');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { getMCPManager, getMCPServersRegistry } = require('~/config');
const db = require('~/models');

/**
 * Mirror MCP lifecycle metadata to the operator catalog. The catalog never
 * receives credentials; each user's native MCP record remains authoritative
 * for private secrets and OAuth state.
 */
function sanitizeMCPForControlPlane(value) {
  const secretWords = [
    'secret', 'token', 'password', 'credential', 'apikey', 'api_key', 'private',
    'authorization', 'cookie', 'session', 'headers',
  ];
  const clean = (item, key = '') => {
    if (item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      return secretWords.some((word) => key.toLowerCase().replace(/-/g, '_').includes(word)) ? undefined : item;
    }
    if (Array.isArray(item)) return item.slice(0, 100).map((entry) => clean(entry, key)).filter((entry) => entry !== undefined);
    if (typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .map(([childKey, childValue]) => [childKey, clean(childValue, childKey)])
          .filter(([, childValue]) => childValue !== undefined),
      );
    }
    return undefined;
  };
  return clean(value) || {};
}

async function syncMCPToControlPlane({ req, serverName, config, deleted = false }) {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!controlPlaneUrl || !internalServiceToken || !serverName) {
    logger.warn('[MCP] Operator catalog synchronization skipped', {
      serverName,
      reason: 'control-plane-not-configured',
    });
    return false;
  }

  const externalUserId = String(req.user?.id || req.user?._id || '');
  let email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';
  // Some auth strategies attach only the Mongo user id to req.user. Resolve
  // the email from the authoritative user collection before giving up; the
  // operator catalog resolves by email as a safe cross-system identity key.
  if (!email && externalUserId) {
    try {
      const persistedUser = await db.findUser({ _id: externalUserId }, 'email');
      email = typeof persistedUser?.email === 'string' ? persistedUser.email.trim() : '';
    } catch (error) {
      logger.warn('[MCP] Failed to resolve authenticated user email', {
        externalUserId,
        message: error.message,
      });
    }
  }
  if (!email) {
    logger.warn('[MCP] Operator catalog synchronization skipped', {
      serverName,
      externalUserId,
      reason: 'authenticated-email-missing',
    });
    return false;
  }

  try {
    await axios.post(
      `${controlPlaneUrl.replace(/\/$/, '')}/api/platform/internal/mcp/sync/`,
      {
        external_user_id: externalUserId,
        email,
        server_name: serverName,
        config: sanitizeMCPForControlPlane(config),
        deleted,
      },
      { timeout: 3000, headers: { 'X-BP-Internal-Token': internalServiceToken } },
    );
    return true;
  } catch (error) {
    // MCP CRUD must remain available when the operator dashboard is being
    // restarted; a later access refresh can reconcile the catalog.
    logger.warn('[MCP] Operator catalog synchronization failed', {
      serverName,
      status: error.response?.status,
      message: error.message,
    });
    return false;
  }
}

/**
 * Reconcile existing user-owned MCP records on every catalog refresh. This
 * repairs records created before the operator mirror was enabled and also
 * makes the mirror self-healing after a control-plane restart.
 */
async function reconcileOwnedMCPServers(req) {
  const userId = req.user?.id || req.user?._id;
  if (!userId || typeof db.findMCPServersByAuthor !== 'function') return;

  try {
    const servers = await db.findMCPServersByAuthor(String(userId));
    // Records materialized from an operator-published asset are projections,
    // not user-created connectors. Do not mirror them back as a second
    // private asset or the catalog would grow once per recipient user.
    const ownedServers = servers.filter((server) => !server?.config?._bpManaged);
    const results = await Promise.all(
      ownedServers.map((server) =>
        syncMCPToControlPlane({
          req,
          serverName: server.serverName,
          config: server.config,
        }),
      ),
    );
    const failed = results.filter((result) => result === false).length;
    if (failed > 0) {
      logger.warn('[MCP] Existing MCP reconciliation had failures', {
        userId: String(userId),
        total: ownedServers.length,
        failed,
      });
    }
  } catch (error) {
    // Listing MCP servers must remain available when the mirror is degraded;
    // the next refresh retries reconciliation.
    logger.warn('[MCP] Existing MCP reconciliation failed', {
      userId: String(userId),
      message: error.message,
    });
  }
}

/**
 * Handles MCP-specific errors and sends appropriate HTTP responses.
 * @param {Error} error - The error to handle
 * @param {import('express').Response} res - Express response object
 * @returns {import('express').Response | null} Response if handled, null if not an MCP error
 */
function handleMCPError(error, res) {
  if (isMCPDomainNotAllowedError(error)) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  if (isMCPInspectionFailedError(error)) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  if (isMCPOAuthSecretReentryRequiredError(error)) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  // Fallback for legacy string-based error handling (backwards compatibility)
  if (error.message?.startsWith(MCPErrorCodes.DOMAIN_NOT_ALLOWED)) {
    return res.status(403).json({
      error: MCPErrorCodes.DOMAIN_NOT_ALLOWED,
      message: error.message.replace(/^MCP_DOMAIN_NOT_ALLOWED\s*:\s*/i, ''),
    });
  }

  if (error.message?.startsWith(MCPErrorCodes.INSPECTION_FAILED)) {
    return res.status(400).json({
      error: MCPErrorCodes.INSPECTION_FAILED,
      message: error.message,
    });
  }

  if (error.message?.startsWith(MCPErrorCodes.OAUTH_SECRET_REENTRY_REQUIRED)) {
    return res.status(400).json({
      error: MCPErrorCodes.OAUTH_SECRET_REENTRY_REQUIRED,
      message: error.message,
    });
  }

  return null;
}

/** Disposes a stale local connection after its DB-backed config has changed. */
async function disconnectLocalMCPServer(userId, serverName) {
  try {
    await getMCPManager()?.disconnectUserConnection(userId, serverName);
  } catch (error) {
    logger.warn(
      `[MCP Cache] Failed to disconnect the local connection for ${serverName} (user: ${userId}):`,
      error,
    );
  }
}

const POST_COMMIT_FENCE_RETRY_DELAYS_MS = [0, 50, 200];

/** Retries the shared fence after persistence; config-bound connections remain a durable
 * fallback if Redis stays unavailable, so an old connection cannot serve the new config. */
async function fenceCommittedMCPMutation({ userId, serverName }) {
  let lastError;
  for (const delay of POST_COMMIT_FENCE_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      await invalidateCachedTools({ userId, serverName });
      return;
    } catch (error) {
      lastError = error;
      logger.warn(
        `[MCP Cache] Failed to fence committed mutation for ${serverName} (user: ${userId}); retrying:`,
        error,
      );
    }
  }
  throw lastError;
}

/**
 * Republishes the pre-mutation catalog under the new fence when persistence
 * fails. The retained connection will reacquire that generation on its next
 * use; this snapshot keeps every replica authoritative in the meantime.
 */
async function restoreRetainedServerCatalog({ userId, serverName, serverConfig, serverTools }) {
  if (serverTools == null) {
    return;
  }
  try {
    const publicationGeneration = await getMCPToolsCacheGeneration({ userId, serverName });
    await cacheMCPServerTools({
      userId,
      serverName,
      serverConfig,
      serverTools,
      publicationGeneration,
    });
  } catch (error) {
    logger.error(
      `[MCP Cache] Failed to restore the retained catalog for ${serverName} (user: ${userId}):`,
      error,
    );
  }
}

/**
 * Get all MCP tools available to the user.
 */
const getMCPTools = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      logger.warn('[getMCPTools] User ID not found in request');
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const mcpConfig = await resolveAllMcpConfigs(userId, req.user);
    /**
     * A server whose normalized name is claimed by an earlier server produces
     * IDENTICAL model-facing tool keys — selecting its tools would silently
     * execute against the first server's config (alias resolution is
     * first-wins). Fail closed: never publish a shadowed server's tools.
     */
    const shadowedServers = findShadowedServerNames(Object.keys(mcpConfig));
    for (const shadowedName of shadowedServers) {
      logger.warn(
        `[getMCPTools] Skipping MCP server "${shadowedName}": its normalized name collides with an earlier configured server, making tool keys ambiguous. Rename one server to expose both.`,
      );
    }
    const configuredServers = Object.keys(mcpConfig).filter(
      (serverName) => !shadowedServers.has(serverName),
    );

    if (!configuredServers.length) {
      return res.status(200).json({ servers: {} });
    }

    const mcpManager = getMCPManager();
    const mcpServers = {};

    const serverToolsMap = new Map();
    const serversWithoutTools = [];
    const cacheResults = await Promise.all(
      configuredServers.map(async (serverName) => {
        try {
          return {
            serverName,
            tools: await getMCPServerTools(userId, serverName, mcpConfig[serverName]),
          };
        } catch (error) {
          logger.error(`[getMCPTools] Error fetching cached tools for ${serverName}:`, error);
          return { serverName, tools: null };
        }
      }),
    );
    for (const { serverName, tools } of cacheResults) {
      if (tools) {
        serverToolsMap.set(serverName, tools);
        continue;
      }

      let serverTools;
      let publicationGeneration;
      try {
        ({ tools: serverTools, publicationGeneration } =
          await mcpManager.getServerToolFunctionsSnapshot(
            userId,
            serverName,
            mcpConfig[serverName],
          ));
      } catch (error) {
        logger.error(`[getMCPTools] Error fetching tools for server ${serverName}:`, error);
        continue;
      }
      if (!serverTools) {
        serversWithoutTools.push(serverName);
        continue;
      }
      serverToolsMap.set(serverName, serverTools);

      // Empty is an authoritative catalog too; re-cache it after TTL expiry to avoid polling.
      cacheMCPServerTools({
        userId,
        serverName,
        serverTools,
        serverConfig: mcpConfig[serverName],
        publicationGeneration,
      }).catch((err) =>
        logger.error(`[getMCPTools] Failed to cache tools for ${serverName}:`, err),
      );
    }
    if (serversWithoutTools.length > 0) {
      logger.debug(
        `[getMCPTools] No tools (${serversWithoutTools.length}): ${serversWithoutTools.join(', ')}`,
      );
    }

    // Process each configured server
    for (const serverName of configuredServers) {
      try {
        const serverTools = serverToolsMap.get(serverName);

        const serverConfig = mcpConfig[serverName];

        const server = {
          name: serverName,
          icon: serverConfig?.iconPath || '',
          authenticated: true,
          authConfig: [],
          tools: [],
        };

        // Set authentication config once for the server
        if (serverConfig?.customUserVars) {
          const customVarKeys = Object.keys(serverConfig.customUserVars);
          if (customVarKeys.length > 0) {
            server.authConfig = Object.entries(serverConfig.customUserVars).map(([key, value]) => ({
              authField: key,
              label: value.title || key,
              description: value.description || '',
              sensitive: value.sensitive,
            }));
            server.authenticated = false;
          }
        }

        // Process tools efficiently - no need for convertMCPToolToPlugin
        if (serverTools) {
          for (const [toolKey, toolData] of Object.entries(serverTools)) {
            if (!toolData.function || !toolKey.includes(Constants.mcp_delimiter)) {
              continue;
            }

            const [toolName] = splitMCPToolKey(toolKey, [
              serverName,
              normalizeServerName(serverName),
            ]);
            server.tools.push({
              name: toolName,
              pluginKey: toolKey,
              description: toolData.function.description || '',
            });
          }
        }

        // Only add server if it has tools or is configured
        if (server.tools.length > 0 || serverConfig) {
          mcpServers[serverName] = server;
        }
      } catch (error) {
        logger.error(`[getMCPTools] Error loading tools for server ${serverName}:`, error);
      }
    }

    res.status(200).json({ servers: mcpServers });
  } catch (error) {
    logger.error('[getMCPTools]', error);
    res.status(500).json({ message: error.message });
  }
};
/**
 * Mirrors canAccessResource's capability bypass plus per-resource ACL EDIT check.
 * `skipCapabilityWithoutDbIds` lets the list path skip the MANAGE_MCP_SERVERS probe
 * when no DB-backed server is present; no list consumer reads the edit-gated fields
 * the bypass would disclose. The detail route must not set it.
 */
async function computeCanEditByServer(req, serverConfigs, { skipCapabilityWithoutDbIds } = {}) {
  const canEditByServer = new Map();
  const dbIdsToCheck = [];
  const dbIdToServerName = new Map();
  for (const [name, config] of Object.entries(serverConfigs)) {
    if (config.dbId) {
      dbIdsToCheck.push(config.dbId);
      dbIdToServerName.set(String(config.dbId), name);
      continue;
    }
    canEditByServer.set(name, isUserSourced(config));
  }
  if (skipCapabilityWithoutDbIds === true && dbIdsToCheck.length === 0) {
    return canEditByServer;
  }
  let bypass = false;
  try {
    bypass = await hasCapability(req.user, SystemCapabilities.MANAGE_MCP_SERVERS);
  } catch (err) {
    logger.warn(`[computeCanEditByServer] Capability bypass check failed: ${err.message}`);
  }
  if (bypass) {
    for (const name of Object.keys(serverConfigs)) {
      canEditByServer.set(name, true);
    }
    return canEditByServer;
  }
  if (dbIdsToCheck.length > 0) {
    try {
      const permsMap = await getResourcePermissionsMap({
        userId: req.user.id,
        role: req.user.role,
        resourceType: ResourceType.MCPSERVER,
        resourceIds: dbIdsToCheck,
      });
      for (const [dbIdStr, name] of dbIdToServerName) {
        const bits = permsMap.get(dbIdStr) ?? 0;
        canEditByServer.set(name, (bits & PermissionBits.EDIT) !== 0);
      }
    } catch (err) {
      logger.warn(
        `[computeCanEditByServer] ACL lookup failed, defaulting to no edit: ${err.message}`,
      );
      for (const name of dbIdToServerName.values()) {
        canEditByServer.set(name, false);
      }
    }
  }
  return canEditByServer;
}

/**
 * Get all MCP servers with permissions
 * @route GET /api/mcp/servers
 */
const getMCPServersList = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    await reconcileOwnedMCPServers(req);
    const serverConfigs = await resolveAllMcpConfigs(userId, req.user);
    const canEditByServer = await computeCanEditByServer(req, serverConfigs, {
      skipCapabilityWithoutDbIds: true,
    });
    return res.json(redactAllServerSecrets(serverConfigs, { canEditByServer }));
  } catch (error) {
    logger.error('[getMCPServersList]', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Test one MCP connection using the exact config and user-scoped credentials
 * that the chat runtime resolves. Credentials are never returned or mirrored
 * to the operator plane; only connectivity, latency and tool count leave this
 * endpoint.
 * @route POST /api/mcp/:serverName/test
 */
const testMCPServerConnection = async (req, res) => {
  const startedAt = Date.now();
  const userId = req.user?.id;
  const serverName = req.params.serverName;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!serverName) return res.status(400).json({ success: false, message: 'Server name is required' });

  try {
    const configServers = await resolveConfigServers(req);
    const serverConfig = await getMCPServersRegistry().getServerConfig(
      serverName,
      userId,
      configServers,
    );
    if (!serverConfig) {
      return res.status(404).json({
        success: false,
        serverName,
        connectionState: 'not_found',
        message: `MCP server '${serverName}' not found`,
      });
    }

    // Bypass the retained catalog so this action is a real connectivity test,
    // while preserving the live connection for the next chat request.
    await invalidateCachedTools({ userId, serverName });
    const mcpManager = getMCPManager(userId);
    const result = await mcpManager.getServerToolFunctionsSnapshot(
      userId,
      serverName,
      serverConfig,
    );
    const tools = result?.tools && typeof result.tools === 'object' ? result.tools : null;
    if (!tools) throw new Error('MCP server returned no tool catalog');

    return res.status(200).json({
      success: true,
      serverName,
      connectionState: 'connected',
      toolCount: Object.keys(tools).length,
      latencyMs: Date.now() - startedAt,
      publicationGeneration: result?.publicationGeneration,
    });
  } catch (error) {
    logger.warn('[testMCPServerConnection] Connection test failed', {
      userId,
      serverName,
      message: error.message,
    });
    return res.status(502).json({
      success: false,
      serverName,
      connectionState: 'error',
      latencyMs: Date.now() - startedAt,
      message: error.message || 'MCP connection test failed',
    });
  }
};

/**
 * Returns true when the request body's parsed config configures OBO. We block
 * non-permission holders from creating or updating any DB-stored MCP server
 * that mints per-user delegated tokens.
 */
function configHasObo(parsedConfig) {
  return (
    !!parsedConfig &&
    typeof parsedConfig === 'object' &&
    'obo' in parsedConfig &&
    parsedConfig.obo != null
  );
}

/**
 * Fields a user without `CONFIGURE_OBO` may modify on an OBO server (allowlist).
 * Any field not on this list is locked: changes to it (add, modify, or remove)
 * require the permission. Allowlisting is fail-closed — when upstream introduces
 * a new MCP server config field, it lands in the locked set by default until
 * explicitly opted in here. Anything that could redirect the OBO token flow
 * (`url`, `proxy`, `headers`), change scopes (`obo`), or reroute auth (`oauth`,
 * `apiKey`, `customUserVars`) MUST stay locked.
 */
const OBO_USER_EDITABLE_FIELDS = new Set(['title', 'description', 'iconPath']);

/**
 * Returns true when any non-allowlisted user-input field differs between the
 * existing server config and the new payload. Treats add, remove, and modify
 * as changes (stable JSON compare, with absence on either side counting as a
 * change unless both sides are absent). The comparison surface is
 * `MCP_USER_INPUT_FIELDS` (schema-derived from `MCPServerUserInputSchema`),
 * so new fields on the schema are picked up automatically and stay locked
 * by default until added to the allowlist above.
 */
function violatesOboLockdown(existingConfig, newConfig) {
  for (const field of MCP_USER_INPUT_FIELDS) {
    if (OBO_USER_EDITABLE_FIELDS.has(field)) continue;
    const existing = existingConfig?.[field];
    const next = newConfig?.[field];
    if (existing === undefined && next === undefined) continue;
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      return true;
    }
  }
  return false;
}

async function callerCanConfigureObo(req) {
  return checkAccess({
    req,
    user: req.user,
    permissionType: PermissionTypes.MCP_SERVERS,
    permissions: [Permissions.CONFIGURE_OBO],
    getRoleByName: db.getRoleByName,
  });
}

/**
 * Create MCP server
 * @route POST /api/mcp/servers
 */
const createMCPServerController = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { config } = req.body;

    const validation = MCPServerUserInputSchema.safeParse(config);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Invalid configuration',
        errors: validation.error.errors,
      });
    }
    if (configHasObo(validation.data) && !(await callerCanConfigureObo(req))) {
      logger.warn(
        `[createMCPServer] User ${userId} attempted to configure OBO without ${Permissions.CONFIGURE_OBO} permission`,
      );
      return res
        .status(403)
        .json({ message: 'Forbidden: Insufficient permissions to configure OBO' });
    }
    /** Reserve both spellings: a generated slug must not collide with a raw
     *  config name OR the normalized form its tool keys actually carry
     *  (deduped — the spellings coincide for safe names). */
    const configNames = await resolveMcpConfigNames(req);
    const reservedServerNames = [
      ...new Set([...configNames, ...configNames.map(normalizeServerName)]),
    ];
    const inspectionServerName = `temp_server_${randomUUID()}`;
    let result;
    try {
      result = await getMCPServersRegistry().addServer(
        inspectionServerName,
        validation.data,
        'DB',
        userId,
        reservedServerNames,
      );
    } finally {
      MCPConnection.clearCooldown(inspectionServerName);
    }
    await syncMCPToControlPlane({ req, serverName: result.serverName, config: result.config });
    res.status(201).json({
      serverName: result.serverName,
      ...redactServerSecrets(result.config, { canEdit: true }),
    });
  } catch (error) {
    logger.error('[createMCPServer]', error);
    const mcpErrorResponse = handleMCPError(error, res);
    if (mcpErrorResponse) {
      return mcpErrorResponse;
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get MCP server by ID
 */
const getMCPServerById = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serverName } = req.params;
    if (!serverName) {
      return res.status(400).json({ message: 'Server name is required' });
    }
    const configServers = await resolveConfigServers(req);
    const parsedConfig = await getMCPServersRegistry().getServerConfig(
      serverName,
      userId,
      configServers,
    );

    if (!parsedConfig) {
      return res.status(404).json({ message: 'MCP server not found' });
    }

    const canEditMap = await computeCanEditByServer(req, { [serverName]: parsedConfig });
    const canEdit = canEditMap.get(serverName) ?? false;
    res.status(200).json(redactServerSecrets(parsedConfig, { canEdit }));
  } catch (error) {
    logger.error('[getMCPServerById]', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Update MCP server
 * @route PATCH /api/mcp/servers/:serverName
 */
const updateMCPServerController = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serverName } = req.params;
    const { config } = req.body;

    const validation = MCPServerUserInputSchema.safeParse(config);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Invalid configuration',
        errors: validation.error.errors,
      });
    }

    /**
     * On an existing OBO server, lock down every user-input field except the
     * cosmetic allowlist (title, description, iconPath) for callers without
     * CONFIGURE_OBO. This closes the OBO redirect vector — without it, a user
     * with UPDATE could change `url` (or `proxy`/`headers`/`customUserVars`)
     * to point OBO-minted tokens at an attacker-controlled endpoint. Adds,
     * modifies, and removes are all caught.
     */
    const existingConfig = await getMCPServersRegistry().getServerConfig(serverName, userId);
    if (configHasObo(existingConfig) && !(await callerCanConfigureObo(req))) {
      if (violatesOboLockdown(existingConfig, validation.data)) {
        logger.warn(
          `[updateMCPServer] User ${userId} attempted to modify a locked field on OBO server '${serverName}' without ${Permissions.CONFIGURE_OBO} permission`,
        );
        return res
          .status(403)
          .json({ message: 'Forbidden: Insufficient permissions to configure OBO' });
      }
    } else if (configHasObo(validation.data) && !(await callerCanConfigureObo(req))) {
      // Adding OBO to a non-OBO server (or first-time configuration) still
      // requires the permission, even if existing has no OBO.
      logger.warn(
        `[updateMCPServer] User ${userId} attempted to add OBO to '${serverName}' without ${Permissions.CONFIGURE_OBO} permission`,
      );
      return res
        .status(403)
        .json({ message: 'Forbidden: Insufficient permissions to configure OBO' });
    }

    const registry = getMCPServersRegistry();
    const parsedConfig = await registry.inspectServerUpdate(
      serverName,
      validation.data,
      'DB',
      userId,
    );
    const retainedTools = await getMCPServerTools(userId, serverName, existingConfig);
    await invalidateCachedTools({ userId, serverName });
    try {
      await registry.commitServerUpdate(serverName, parsedConfig, 'DB', userId);
    } catch (error) {
      await restoreRetainedServerCatalog({
        userId,
        serverName,
        serverConfig: existingConfig,
        serverTools: retainedTools,
      });
      throw error;
    }
    /** Fence connections another replica could have created from the old DB
     * config between the pre-commit fence and the committed update. */
    await fenceCommittedMCPMutation({ userId, serverName });
    await disconnectLocalMCPServer(userId, serverName);

    await syncMCPToControlPlane({ req, serverName, config: parsedConfig });
    res.status(200).json(redactServerSecrets(parsedConfig, { canEdit: true }));
  } catch (error) {
    logger.error('[updateMCPServer]', error);
    const mcpErrorResponse = handleMCPError(error, res);
    if (mcpErrorResponse) {
      return mcpErrorResponse;
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * Delete MCP server
 * @route DELETE /api/mcp/servers/:serverName
 */
const deleteMCPServerController = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serverName } = req.params;
    const registry = getMCPServersRegistry();
    const existingConfig = await registry.getServerConfig(serverName, userId);
    const retainedTools = await getMCPServerTools(userId, serverName, existingConfig);
    await invalidateCachedTools({ userId, serverName });
    try {
      await registry.removeServer(serverName, 'DB', userId);
    } catch (error) {
      await restoreRetainedServerCatalog({
        userId,
        serverName,
        serverConfig: existingConfig,
        serverTools: retainedTools,
      });
      throw error;
    }
    /** Fence connections another replica could have created before deletion committed. */
    await fenceCommittedMCPMutation({ userId, serverName });
    await disconnectLocalMCPServer(userId, serverName);
    await syncMCPToControlPlane({ req, serverName, config: existingConfig, deleted: true });
    res.status(200).json({ message: 'MCP server deleted successfully' });
  } catch (error) {
    logger.error('[deleteMCPServer]', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getMCPTools,
  getMCPServersList,
  reconcileOwnedMCPServers,
  testMCPServerConnection,
  createMCPServerController,
  getMCPServerById,
  updateMCPServerController,
  deleteMCPServerController,
};
