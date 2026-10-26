import type { GatewayDeps } from './config';
import { gatewayConfig } from './config';
export { gatewayConfig } from './config';
import type {
  GovernanceFeed,
  AppConfig,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import { ManagedUserError } from './users';
import { managedRoleProjection, nativeFeatureContract } from './permissions';
export { createManagedUserManager } from './users';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { verifyOidcAccessToken, extractBearerToken } from '~/auth/oidc';

interface ManagedUser {
  governanceDisabled?: boolean;
  id?: string;
  _id?: { toString(): string };
  openidId?: string;
  openidIssuer?: string;
  provider?: string;
  tenantId?: string;
}
let cachedToken: { value: string; expires: number; client: string } | undefined;
export async function machineToken(c: GatewayDeps): Promise<string> {
  if (cachedToken && cachedToken.client === c.clientId && cachedToken.expires > Date.now() + 10000)
    return cachedToken.value;
  const r = await c.fetch(c.issuer + '/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('GATEWAY_SERVICE_AUTH_UNAVAILABLE');
  const token = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: token.access_token,
    expires: Date.now() + token.expires_in * 1000,
    client: c.clientId,
  };
  return token.access_token;
}
async function identitySessions(c: GatewayDeps, subject: string): Promise<Array<{ id: string }>> {
  if (!/^[a-f0-9-]{36}$/i.test(subject)) throw new Error('SUBJECT_INVALID');
  const admin = c.issuer.replace('/realms/', '/admin/realms/');
  const headers = { Authorization: 'Bearer ' + (await machineToken(c)) };
  const [response, user] = await Promise.all([
    c.fetch(admin + '/users/' + encodeURIComponent(subject) + '/sessions', {
      headers,
      signal: AbortSignal.timeout(10000),
    }),
    c.fetch(admin + '/users/' + encodeURIComponent(subject), {
      headers,
      signal: AbortSignal.timeout(10000),
    }),
  ]);
  if (!response.ok || !user.ok) throw new Error('IDENTITY_SESSION_UNAVAILABLE');
  if (((await user.json()) as { enabled?: boolean }).enabled !== true) return [];
  return (await response.json()) as Array<{ id: string }>;
}
export async function validateManagedJwtUser<T extends ManagedUser>(
  user: T | null,
  payload: Record<string, unknown>,
  workload = false,
): Promise<T | null> {
  if (user?.governanceDisabled || payload.scope === 'rag_workload') return null;
  const c: GatewayDeps | null = gatewayConfig();
  if (!c) return user;
  if (!user || user.provider !== 'openid' || user.openidIssuer !== c.issuer || !user.openidId)
    return null;
  try {
    if (
      workload &&
      payload.scope === 'agent_trigger' &&
      typeof payload.iat === 'number' &&
      typeof payload.exp === 'number' &&
      payload.iat <= Date.now() / 1000 + 5 &&
      payload.exp > payload.iat &&
      payload.exp > Date.now() / 1000 &&
      payload.exp - payload.iat <= 60
    ) {
      const response = await c.fetch(
        c.issuer.replace('/realms/', '/admin/realms/') +
          '/users/' +
          encodeURIComponent(user.openidId),
        {
          headers: { Authorization: 'Bearer ' + (await machineToken(c)) },
          signal: AbortSignal.timeout(10000),
        },
      );
      return response.ok && ((await response.json()) as { enabled?: boolean }).enabled === true
        ? user
        : null;
    }
    if (typeof payload.identitySessionId !== 'string') return null;
    const sessions = await identitySessions(c, user.openidId);
    return sessions.some((s) => s.id === payload.identitySessionId) ? user : null;
  } catch {
    return null;
  }
}
export function managedSessionOptions(
  req: { user?: { tokenset?: { id_token?: string } } } | null,
  expiresIn: number,
): { expiresIn: number; identitySessionId?: string } {
  if (!gatewayConfig()) return { expiresIn };
  const token = req?.user?.tokenset?.id_token;
  const decoded = token ? jwt.decode(token) : null;
  const sid =
    decoded && typeof decoded === 'object' && typeof decoded.sid === 'string'
      ? decoded.sid
      : undefined;
  if (!sid) throw new Error('IDENTITY_SESSION_REQUIRED');
  return { expiresIn, identitySessionId: sid };
}
export async function resolveManagedCredential(
  user: ManagedUser | undefined,
  endpoint: string,
  model?: unknown,
  c: GatewayDeps | null = gatewayConfig(),
  capability = 'chat',
): Promise<{ key: string; models: string[]; baseURL: string } | null> {
  if (!c) return null;
  if (
    endpoint !== c.endpoint ||
    user?.provider !== 'openid' ||
    !user.openidId ||
    user.openidIssuer !== c.issuer
  )
    throw new Error('MANAGED_ENDPOINT_REQUIRED');
  const account = await c.fetch(
    c.issuer.replace('/realms/', '/admin/realms/') + '/users/' + encodeURIComponent(user.openidId),
    {
      headers: { Authorization: 'Bearer ' + (await machineToken(c)) },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!account.ok || ((await account.json()) as { enabled?: boolean }).enabled !== true)
    throw new Error('PRINCIPAL_DISABLED');
  const r = await c.fetch(c.bridgeURL + '/resolve?subject=' + encodeURIComponent(user.openidId), {
    headers: { Authorization: 'Bearer ' + (await machineToken(c)) },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('MANAGED_ENTITLEMENT_UNAVAILABLE');
  const result = (await r.json()) as {
    subject: string;
    issuer: string;
    key: string;
    offers: Array<{ id: string; capabilities?: string[] }>;
  };
  if (result.subject !== user.openidId || result.issuer !== c.issuer || !result.key)
    throw new Error('MANAGED_SUBJECT_MISMATCH');
  const models = result.offers
    .filter(
      (x) => (capability === 'chat' && !x.capabilities) || x.capabilities?.includes(capability),
    )
    .map((x) => x.id);
  if (model != null && (typeof model !== 'string' || !models.includes(model)))
    throw new Error('MODEL_NOT_ASSIGNED');
  const destination = new URL(c.bridgeURL);
  destination.pathname = '/v1';
  destination.search = '';
  destination.hash = '';
  return { key: result.key, models, baseURL: destination.toString().replace(/\/$/, '') };
}
export async function managedModelCatalog(
  user: ManagedUser | undefined,
): Promise<Record<string, string[]> | null> {
  const c: GatewayDeps | null = gatewayConfig();
  if (!c) return null;
  const resolved = await resolveManagedCredential(user, c.endpoint, undefined, c);
  return { [c.endpoint]: resolved?.models ?? [] };
}
export async function requireManagedEndpoint(
  user: ManagedUser | undefined,
  endpoint: string,
): Promise<void> {
  const c: GatewayDeps | null = gatewayConfig();
  if (c && endpoint !== c.endpoint) throw new Error('MANAGED_ENDPOINT_REQUIRED');
  void user;
}
interface BridgeUser {
  _id?: { toString(): string };
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  provider?: string;
  openidId?: string;
  openidIssuer?: string;
  tenantId?: string;
}
interface BridgeDependencies {
  getRole?: (
    name: string,
  ) => Promise<{ permissions?: Record<string, Record<string, boolean>> } | null>;
  operationalEvents?: (after: number, limit: number) => Promise<GovernanceFeed>;
  manageUser?: (body: unknown) => Promise<{ id: string; subject?: string; active: boolean }>;
  findUsers: (
    filter: object,
    projection: string,
    options: { limit: number },
  ) => Promise<BridgeUser[]>;
  getUserById: (id: string) => Promise<BridgeUser | null>;
  grantCapability: (input: {
    principalType: 'user';
    principalId: string;
    capability: string;
    tenantId?: string;
  }) => Promise<unknown>;
  recordAuditEntry: (
    input: RecordAuditEntryInput,
    options?: RecordAuditEntryOptions,
  ) => Promise<unknown>;
}
export function createGatewayBridge(
  deps: BridgeDependencies,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    const c: GatewayDeps | null = gatewayConfig();
    if (!c) {
      res.status(404).json({ code: 'GATEWAY_DISABLED' });
      return;
    }
    try {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        res.status(401).json({ code: 'BRIDGE_AUTH_REQUIRED' });
        return;
      }
      const identity = await verifyOidcAccessToken(token, {
        issuer: c.issuer,
        audience: c.audience,
      }).catch(() => null);
      if (!identity) {
        res.status(401).json({ code: 'BRIDGE_AUTH_REQUIRED' });
        return;
      }
      const roles = (identity.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
      if (req.method === 'GET' && req.path === '/feature-schema' && roles.includes('bp:lc-read')) {
        res.json({ version: 1, families: nativeFeatureContract() });
        return;
      }
      if (
        req.method === 'GET' &&
        req.path === '/features' &&
        roles.includes('bp:lc-read') &&
        deps.getRole
      ) {
        const id = String(req.query.user_id ?? '');
        if (!/^[a-f0-9]{24}$/i.test(id)) {
          res.status(422).json({ code: 'USER_ID_REQUIRED' });
          return;
        }
        const user = await deps.getUserById(id);
        if (!user) {
          res.status(404).json({ code: 'USER_NOT_FOUND' });
          return;
        }
        const role = await deps.getRole(user.role ?? 'USER');
        const permissions = managedRoleProjection(
          role ?? { permissions: {} },
          user as BridgeUser & { governancePermissions?: Record<string, Record<string, boolean>> },
          true,
        ).permissions;
        res.json({ version: 1, role: user.role, permissions });
        return;
      }
      if (req.method === 'GET' && req.path === '/capabilities' && roles.includes('bp:lc-read')) {
        res.json({
          version: 1,
          managed_users: true,
          native_admin: true,
          resources: true,
          operational_events: !!deps.operationalEvents,
        });
        return;
      }
      if (
        req.method === 'GET' &&
        req.path === '/events' &&
        roles.includes('bp:lc-read') &&
        deps.operationalEvents
      ) {
        const after = Number(req.query.after ?? 0),
          limit = Number(req.query.limit ?? 200);
        if (
          !Number.isSafeInteger(after) ||
          after < 0 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 500
        ) {
          res.status(422).json({ code: 'INVALID_EVENT_CURSOR' });
          return;
        }
        res.json(await deps.operationalEvents(after, limit));
        return;
      }

      if (
        req.method === 'GET' &&
        req.path === '/embedding-credential' &&
        roles.includes('bp:resolve') &&
        identity.azp === 'bpbatam-rag-service'
      ) {
        const id = String(req.query.user_id ?? '');
        if (!/^[a-f0-9]{24}$/i.test(id)) {
          res.status(422).json({ code: 'USER_ID_REQUIRED' });
          return;
        }
        const person = await deps.getUserById(id);
        if (!person || (person as ManagedUser).governanceDisabled) {
          res.status(403).json({ code: 'PRINCIPAL_UNAVAILABLE' });
          return;
        }
        const credential = await resolveManagedCredential(
          person,
          c.endpoint,
          undefined,
          c,
          'embedding',
        );
        if (!credential?.models.length) {
          res.status(403).json({ code: 'EMBEDDING_NOT_ASSIGNED' });
          return;
        }
        res.json({ baseURL: credential.baseURL, key: credential.key, model: credential.models[0] });
        return;
      }

      if (
        req.method === 'POST' &&
        req.path === '/users' &&
        roles.includes('bp:lc-users') &&
        deps.manageUser
      ) {
        const pending = {
          action: 'user.updated' as const,
          outcome: 'pending' as const,
          severity: 'warning' as const,
          actor: {
            type: 'service' as const,
            id: identity.sub,
            name: String(identity.azp ?? 'control-plane-service'),
          },
          target: {
            type: 'user',
            id: typeof req.body?.userId === 'string' ? req.body.userId : undefined,
          },
          metadata: {
            operation: 'managed-identity-lifecycle',
            phase: 'authorized-command',
            commandId: String(req.headers['x-command-id'] ?? ''),
          },
        };
        await deps.recordAuditEntry(pending, { failClosed: true });
        const result = await deps.manageUser(req.body);
        await deps.recordAuditEntry(
          {
            ...pending,
            outcome: 'success',
            target: { type: 'user', id: result.id },
            metadata: {
              operation: 'managed-identity-lifecycle',
              phase: 'completed',
              commandId: String(req.headers['x-command-id'] ?? ''),
            },
          },
          { failClosed: true },
        );
        res.json(result);
        return;
      }
      if (req.method === 'GET' && req.path === '/users' && roles.includes('bp:lc-read')) {
        const users = await deps.findUsers(
          {},
          '_id name email role provider openidId openidIssuer',
          { limit: 200 },
        );
        res.json({
          users: users.map((u) => ({
            id: u.id ?? u._id?.toString(),
            name: u.name,
            email: u.email,
            role: u.role,
            provider: u.provider,
            subject: u.openidId,
            issuer: u.openidIssuer,
          })),
        });
        return;
      }
      if (req.method === 'POST' && req.path === '/grants' && roles.includes('bp:lc-write')) {
        const body = req.body as { userId?: unknown; capability?: unknown };
        const cap = body.capability;
        const allowed = ['read:users', 'read:groups', 'read:roles', 'read:configs:interface'];
        if (
          typeof body.userId !== 'string' ||
          !/^[a-f0-9]{24}$/i.test(body.userId) ||
          typeof cap !== 'string' ||
          !allowed.includes(cap)
        ) {
          res.status(400).json({ code: 'INVALID_DELEGATED_GRANT' });
          return;
        }
        const user = await deps.getUserById(body.userId);
        if (!user) {
          res.status(404).json({ code: 'USER_NOT_FOUND' });
          return;
        }
        // Audit precedes grant; failure must not produce an unaudited elevation.
        await deps.recordAuditEntry(
          {
            action: 'grant.assigned',
            outcome: 'success',
            severity: 'warning',
            actor: { type: 'service', id: identity.sub, name: identity.azp ?? 'gateway-service' },
            target: { type: 'user', id: body.userId },
            metadata: { capability: cap, phase: 'authorized-command' },
            tenantId: user.tenantId,
          },
          { failClosed: true },
        );
        await deps.grantCapability({
          principalType: 'user',
          principalId: body.userId,
          capability: cap,
          tenantId: user.tenantId,
        });
        res.status(201).json({ granted: true });
        return;
      }
      res.status(403).json({ code: 'BRIDGE_SCOPE_DENIED' });
    } catch (error) {
      if (error instanceof ManagedUserError) {
        res.status(error.status).json({ code: error.code });
        return;
      }
      res.status(503).json({ code: 'BRIDGE_DEPENDENCY_UNAVAILABLE' });
    }
  };
}

export async function combineManagedModels(
  user: ManagedUser | undefined,
  defaults: Record<string, string[]>,
  custom: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  return (await managedModelCatalog(user)) ?? { ...defaults, ...custom };
}

export async function isManagedRefreshSessionValid(
  user: ManagedUser,
  session: { identitySessionId?: string },
): Promise<boolean> {
  return !!(await validateManagedJwtUser(user, { identitySessionId: session.identitySessionId }));
}

export {
  createGovernanceDelegation,
  managedAdminGate,
  governanceBanGate,
  managedRoleMutationGate,
  isVerifiedGovernanceRequest,
  withGovernanceAuthentication,
  governanceIdentity,
  runGovernanceOwner,
} from './delegation';

export interface ManagedMediaConfiguration {
  apiKey: string;
  baseURL: string;
  model: string;
  url: string;
  voices: string[];
  allowedAddresses: string[];
}
export async function managedMediaConfig(
  user: ManagedUser | undefined,
  capability: 'tts' | 'transcribe' | 'image',
): Promise<ManagedMediaConfiguration | null> {
  const c = gatewayConfig();
  if (!c) return null;
  const credential = await resolveManagedCredential(user, c.endpoint, undefined, c, capability);
  if (!credential || !credential.models.length) throw new Error('MEDIA_MODEL_NOT_ASSIGNED');
  return {
    apiKey: credential.key,
    baseURL: credential.baseURL,
    model: credential.models[0],
    url:
      credential.baseURL +
      { tts: '/audio/speech', transcribe: '/audio/transcriptions', image: '/images/generations' }[
        capability
      ],
    voices: ['default', 'F1'],
    allowedAddresses: [new URL(credential.baseURL).host],
  };
}

export { createGovernanceResources } from './resources';

export { createGovernanceErasure, requiresSelfServiceErasure } from './erasure';

export { managedRoleProjection } from './permissions';

export { createGovernanceMutationJournal, createGovernanceJournalHandler } from './journal';

export {
  createGovernanceDispatcher,
  createGovernanceResourceInvalidator,
  localIdentityDiscoveryOptions,
} from './wiring';

export async function managedSpeechSchema<T>(
  legacy: T,
  user: ManagedUser | undefined,
  capability: 'tts' | 'transcribe',
): Promise<T | { openai: ManagedMediaConfiguration; allowedAddresses: string[] }> {
  const governed = await managedMediaConfig(user, capability);
  return governed ? { openai: governed, allowedAddresses: governed.allowedAddresses } : legacy;
}

export async function managedSpeechConfiguration(
  legacy: AppConfig,
  user: ManagedUser | undefined,
): Promise<AppConfig> {
  const tts = await managedSpeechSchema(legacy?.speech?.tts, user, 'tts');
  return {
    ...legacy,
    speech: { ...legacy?.speech, tts },
  } as AppConfig;
}

export async function managedImageConfiguration<T extends { apiKey?: string; baseURL?: string }>(
  user: ManagedUser | undefined,
  imageModel: string,
  baseURL: string | undefined,
  closureConfig: T,
): Promise<{
  selectedModel: string;
  destination: string | undefined;
  apiKey: string | undefined;
  clientConfig: T;
}> {
  const governed = await managedMediaConfig(user, 'image');
  return {
    selectedModel: governed?.model ?? imageModel,
    destination: governed?.baseURL ?? baseURL,
    apiKey: governed?.apiKey ?? closureConfig.apiKey,
    clientConfig: governed
      ? { ...closureConfig, apiKey: governed.apiKey, baseURL: governed.baseURL }
      : closureConfig,
  };
}

export { createGovernanceGrantAuthority } from './delegation';
