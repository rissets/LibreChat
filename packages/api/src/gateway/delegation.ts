/** Explicit, audited service delegation. Never accepted on ordinary user/admin routes. */
import { isValidCapability } from '@librechat/data-schemas';
import type { RecordAuditEntryInput, RecordAuditEntryOptions } from '@librechat/data-schemas';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AdminGrantsDeps } from '../admin/grants';
import { verifyOidcAccessToken, extractBearerToken } from '~/auth/oidc';
import { capabilityStore } from '~/middleware/capabilities';
import { gatewayConfig } from './config';

const verified = new WeakSet<object>();
export function isVerifiedGovernanceRequest(req: object): boolean {
  return verified.has(req);
}
const surfaces: Record<string, string[]> = {
  config: ['read:configs', 'manage:configs', 'assign:configs'],
  groups: ['read:groups', 'manage:groups'],
  roles: ['read:roles', 'manage:roles'],
  grants: ['read:roles', 'manage:roles', 'read:configs', 'manage:configs', 'assign:configs'],
  skills: ['read:skills', 'manage:skills', 'manage:configs'],
  langfuse: ['read:configs', 'manage:configs'],
  'code-environments': ['manage:code_environments'],
  'audit-log': ['read:audit_log'],
  users: ['read:users'],
};
export function createGovernanceDelegation(deps: {
  findUsers: (
    filter: object,
    projection: string,
    options: { limit: number },
  ) => Promise<Array<Record<string, unknown>>>;
  audit: (input: RecordAuditEntryInput, options?: RecordAuditEntryOptions) => Promise<unknown>;
}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const c = gatewayConfig();
    const token = extractBearerToken(req.headers.authorization);
    if (!c || !token) {
      res.status(401).json({ code: 'BRIDGE_AUTH_REQUIRED' });
      return;
    }
    try {
      const identity = await verifyOidcAccessToken(token, {
        issuer: c.issuer,
        audience: c.audience,
      });
      const roles = (identity.realm_access as { roles?: string[] })?.roles ?? [];
      const surface = req.path.split('/')[1];
      if (!roles.includes('bp:lc-admin') || !surfaces[surface]) {
        res.status(403).json({ code: 'BRIDGE_SCOPE_DENIED' });
        return;
      }
      const subject = req.headers['x-actor-subject'];
      if (typeof subject !== 'string' || !/^[a-f0-9-]{36}$/i.test(subject)) {
        res.status(403).json({ code: 'EXPLICIT_ACTOR_REQUIRED' });
        return;
      }
      const people = await deps.findUsers(
        { openidIssuer: c.issuer, openidId: subject, governanceDisabled: { $ne: true } },
        '_id name role tenantId provider openidId openidIssuer',
        { limit: 2 },
      );
      if (people.length !== 1) {
        res.status(403).json({ code: 'ACTOR_IDENTITY_UNAVAILABLE' });
        return;
      }
      const person = people[0];
      const id = String(person._id);
      const caps = ['access:admin', ...surfaces[surface]];
      const entry: RecordAuditEntryInput = {
        action: 'user.updated',
        outcome: 'pending',
        severity: 'warning',
        actor: { type: 'service', id: identity.sub, name: String(identity.azp) },
        target: { type: 'governance', id: surface },
        metadata: {
          actorSubject: subject,
          actorId: String(req.headers['x-actor-id'] ?? ''),
          commandId: String(req.headers['x-command-id'] ?? ''),
          method: req.method,
          path: req.path,
        },
      };
      await deps.audit(entry, { failClosed: true });
      Object.assign(req, { user: { ...person, id, _id: person._id } });
      verified.add(req);
      capabilityStore.run(
        {
          principals: new Map(),
          results: new Map(),
          delegation: {
            userId: id,
            capabilities: new Set(caps),
            nativeGrantAuthority: surface === 'grants',
          },
        },
        () => next(),
      );
    } catch {
      res.status(503).json({ code: 'GOVERNANCE_AUTH_UNAVAILABLE' });
    }
  };
}

export async function governanceIdentity(
  req: Request,
  role: string,
): Promise<{ sub: string; name: string } | null> {
  const c = gatewayConfig();
  const token = extractBearerToken(req.headers.authorization);
  if (!c || !token) return null;
  const identity = await verifyOidcAccessToken(token, {
    issuer: c.issuer,
    audience: c.audience,
  }).catch(() => null);
  if (
    !identity?.sub ||
    !((identity.realm_access as { roles?: string[] })?.roles ?? []).includes(role)
  )
    return null;
  return { sub: identity.sub, name: String(identity.azp ?? 'control-plane-service') };
}
export function runGovernanceOwner<T>(req: Request, user: Record<string, unknown>, fn: () => T): T {
  const id = String(user._id);
  Object.assign(req, { user: { ...user, id } });
  verified.add(req);
  return capabilityStore.run(
    {
      principals: new Map(),
      results: new Map(),
      delegation: { userId: id, capabilities: new Set(['access:admin']), manageResources: true },
    },
    fn,
  );
}

/** Managed deployments have one administrative authority; native controllers remain service-delegated. */
export function managedAdminGate(req: Request, res: Response, next: NextFunction): void {
  if (gatewayConfig() && !verified.has(req)) {
    res.status(403).json({ code: 'USE_CONTROL_PLANE' });
    return;
  }
  next();
}
export function managedRoleMutationGate(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  managedAdminGate(req, res, next);
}

/** Administrative resource lifecycle remains available to verified moderators of a banned account. */
export function governanceBanGate(
  check: (req: Request, res: Response, next: NextFunction) => unknown,
): (req: Request, res: Response, next: NextFunction) => unknown {
  return (req: Request, res: Response, next: NextFunction): unknown =>
    verified.has(req) ? next() : check(req, res, next);
}

/** Only the audited native-resource bridge can bypass browser authentication. */
export function withGovernanceAuthentication(authenticate: RequestHandler): RequestHandler {
  return (req, res, next) =>
    isVerifiedGovernanceRequest(req) ? next() : authenticate(req, res, next);
}

/** Native grants use database-level checks; the audited service delegation has CP approval authority. */
export function createGovernanceGrantAuthority(
  deps: Pick<AdminGrantsDeps, 'getHeldCapabilities' | 'hasCapabilityForPrincipals'>,
): typeof deps {
  return {
    getHeldCapabilities: async (input) =>
      capabilityStore.getStore()?.delegation?.nativeGrantAuthority
        ? new Set(input.capabilities.filter(isValidCapability))
        : deps.getHeldCapabilities(input),
    hasCapabilityForPrincipals: async (input) =>
      capabilityStore.getStore()?.delegation?.nativeGrantAuthority
        ? isValidCapability(input.capability)
        : deps.hasCapabilityForPrincipals(input),
  };
}
