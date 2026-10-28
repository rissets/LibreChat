import { z } from 'zod';
import type { RecordAuditEntryInput } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { GatewayDeps } from './config';
import { machineToken } from './index';

interface SelfUser {
  provider?: string;
  openidId?: string;
  openidIssuer?: string;
  governanceDisabled?: boolean;
  tenantId?: string;
}
interface SelfDeps {
  config: () => GatewayDeps | null;
  audit: (input: RecordAuditEntryInput) => Promise<unknown>;
}
class SelfError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const createBody = z
  .object({ name: z.string().trim().min(1).max(100), command_id: z.string().uuid() })
  .strict();
/** Browser authority comes exclusively from the authenticated immutable subject, never request data. */
type SelfHandler = (req: Request, res: Response) => Promise<void>;
export function createManagedSelfService(deps: SelfDeps): {
  account: SelfHandler;
  keys: SelfHandler;
  create: SelfHandler;
  remove: SelfHandler;
  reveal: SelfHandler;
  rename: SelfHandler;
  requests: SelfHandler;
  requestTokens: SelfHandler;
} {
  const handler =
    (
      action:
        | 'account'
        | 'keys'
        | 'create'
        | 'delete'
        | 'reveal'
        | 'rename'
        | 'requests'
        | 'requestTokens',
    ) =>
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const c = deps.config();
        if (!c) throw new SelfError('GATEWAY_DISABLED', 404);
        const user = req.user as SelfUser | undefined;
        if (
          !user ||
          user.governanceDisabled ||
          user.provider !== 'openid' ||
          user.openidIssuer !== c.issuer ||
          !z.string().uuid().safeParse(user.openidId).success
        )
          throw new SelfError('MANAGED_IDENTITY_REQUIRED', 403);
        if (
          action === 'create' ||
          action === 'delete' ||
          action === 'reveal' ||
          action === 'rename' ||
          action === 'requestTokens'
        ) {
          const origin = req.get('origin');
          let sameOrigin = false;
          try {
            sameOrigin = !!origin && new URL(origin).host === req.get('host');
          } catch {
            /* Malformed origins are denied. */
          }
          if (!sameOrigin) throw new SelfError('ORIGIN_DENIED', 403);
        }
        const subject = user.openidId!;
        let path = '/self-keys';
        if (action === 'account') path = '/self-account';
        else if (action === 'requests') path = '/self-topups';
        let body: Record<string, unknown> | undefined;
        if (action === 'requestTokens') {
          const parsed = z
            .object({
              amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
              reason: z.string().trim().min(10).max(1000),
              request_id: z.string().uuid(),
            })
            .strict()
            .safeParse(req.body);
          if (!parsed.success) throw new SelfError('INVALID_TOKEN_REQUEST', 422);
          path = '/commands';
          body = { op: 'self-topup-request', subject, ...parsed.data };
        } else if (action === 'create') {
          const parsed = createBody.safeParse(req.body);
          if (!parsed.success) throw new SelfError('INVALID_KEY_INPUT', 422);
          path = '/commands';
          body = { op: 'self-key-create', subject, ...parsed.data };
        } else if (action === 'reveal' || action === 'rename') {
          if (!z.string().uuid().safeParse(req.params.id).success)
            throw new SelfError('INVALID_KEY_ID', 422);
          path = '/commands';
          body = {
            op: action === 'reveal' ? 'self-key-reveal' : 'self-key-rename',
            subject,
            key_id: req.params.id,
          };
          if (action === 'rename') {
            const parsed = z
              .object({ name: z.string().trim().min(1).max(100) })
              .strict()
              .safeParse(req.body);
            if (!parsed.success) throw new SelfError('INVALID_KEY_INPUT', 422);
            body.name = parsed.data.name;
          }
        } else if (action === 'delete') {
          if (!z.string().uuid().safeParse(req.params.id).success)
            throw new SelfError('INVALID_KEY_ID', 422);
          path = '/commands';
          body = { op: 'self-key-delete', subject, key_id: req.params.id };
        }
        const response = await c.fetch(
          c.bridgeURL + path + (body ? '' : '?subject=' + encodeURIComponent(subject)),
          {
            method: body ? 'POST' : 'GET',
            headers: {
              Authorization: 'Bearer ' + (await machineToken(c)),
              'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as {
            code?: string;
            error?: { code?: string; message?: string };
          };
          const candidate = error.code ?? error.error?.code ?? error.error?.message;
          throw new SelfError(
            candidate && /^[A-Z_]+$/.test(candidate) ? candidate : 'GATEWAY_UNAVAILABLE',
            [403, 404, 409, 422, 429].includes(response.status) ? response.status : 503,
          );
        }
        const value = (await response.json()) as Record<string, unknown>;
        if (
          action === 'create' ||
          action === 'delete' ||
          action === 'reveal' ||
          action === 'rename' ||
          action === 'requestTokens'
        )
          await deps.audit({
            action: 'user.updated',
            tenantId: user.tenantId,
            actor: { type: 'user', id: subject, name: subject },
            target: {
              type: action === 'requestTokens' ? 'gateway-token-request' : 'gateway-key',
              id: String(value.id ?? value.key_id ?? req.params.id ?? ''),
            },
            metadata: {
              subject,
              operation:
                action === 'requestTokens' ? 'gateway.tokens.request' : 'gateway.key.' + action,
            },
          });
        if (action === 'account') {
          if (value.subject !== subject || value.issuer !== c.issuer)
            throw new SelfError('MANAGED_SUBJECT_MISMATCH', 403);
          delete value.subject;
          delete value.issuer;
          res.json({ ...value, endpoint: c.endpoint, api_base_url: c.publicAPIURL ?? null });
        } else
          res.status(action === 'create' || action === 'requestTokens' ? 201 : 200).json(value);
      } catch (error) {
        res
          .status(error instanceof SelfError ? error.status : 503)
          .json({ code: error instanceof SelfError ? error.code : 'GATEWAY_UNAVAILABLE' });
      }
    };
  return {
    account: handler('account'),
    keys: handler('keys'),
    create: handler('create'),
    remove: handler('delete'),
    reveal: handler('reveal'),
    rename: handler('rename'),
    requests: handler('requests'),
    requestTokens: handler('requestTokens'),
  };
}
