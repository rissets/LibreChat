import type { RequestHandler } from 'express';
import { invalidateLinkedPrompt } from '../agents/instructions/linked';

/** Express supplies next as argument three; expansion requires an explicit boolean. */
export function explicitExpansionHandler<TReq, TRes, TResult>(
  handler: (req: TReq, res: TRes, expand?: boolean) => TResult,
): (req: TReq, res: TRes, expansionOrNext?: unknown) => TResult {
  return (req, res, expansionOrNext) => handler(req, res, expansionOrNext === true);
}

/** Explicitly enabled HTTP discovery is restricted to the local identity deployment. */
export function localIdentityDiscoveryOptions<T>(
  issuer: string,
  enabled: string | undefined,
  allow: T,
): { execute?: T[] } {
  if (enabled !== 'true') return {};
  const url = new URL(issuer);
  return url.protocol === 'http:' && ['localhost', 'bpbatam-idp.localhost'].includes(url.hostname)
    ? { execute: [allow] }
    : {};
}

export function createGovernanceDispatcher(deps: {
  configure: RequestHandler;
  load: (route: string) => RequestHandler | { v1: RequestHandler };
  loadUpload: () => Promise<RequestHandler>;
}): (route: string, ...args: Parameters<RequestHandler>) => ReturnType<RequestHandler> {
  let upload: Promise<RequestHandler> | undefined;
  return (route, req, res, next) =>
    deps.configure(req, res, () => {
      if (route !== 'files-upload') {
        try {
          const native = deps.load(route);
          const handler = typeof native === 'function' ? native : native.v1;
          return handler(req, res, next);
        } catch (error) {
          return next(error);
        }
      }
      upload ??= deps.loadUpload().catch((error: unknown) => {
        upload = undefined;
        throw error;
      });
      return upload.then((handler) => handler(req, res, next)).catch(next);
    });
}

export function createGovernanceResourceInvalidator(deps: {
  config: () => Promise<unknown>;
  linkedCache: Parameters<typeof invalidateLinkedPrompt>[0];
  mcp?: {
    registry: () => { invalidateGovernedServer: (name: string, userId: string) => Promise<void> };
    fence: (target: { userId: string; serverName: string }) => Promise<unknown>;
    manager: () => { disconnectUserConnection: (userId: string, name: string) => Promise<unknown> };
  };
}): (kind?: string, id?: string, promptIds?: string[], ownerId?: string) => Promise<void> {
  return async (kind, id, promptIds = [], ownerId) => {
    if (kind === 'mcp-servers' && id && ownerId && deps.mcp) {
      await deps.mcp.registry().invalidateGovernedServer(id, ownerId);
      await deps.mcp.fence({ userId: ownerId, serverName: id });
      await deps.mcp.manager().disconnectUserConnection(ownerId, id);
    }
    await Promise.all([
      deps.config(),
      ...(kind === 'prompts' && id
        ? [invalidateLinkedPrompt(deps.linkedCache, id, promptIds)]
        : []),
    ]);
  };
}
