import { createHash } from 'node:crypto';
import type {
  GovernanceCommandStore,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { governanceIdentity } from './delegation';
interface JournalDependencies {
  store: GovernanceCommandStore;
  encrypt: (value: string) => Promise<string>;
  decrypt: (value: string) => Promise<string>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function beginGovernanceMutation(
  req: Request,
  res: Response,
  deps: JournalDependencies,
): Promise<boolean> {
  const id = req.headers['x-command-id'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9:._-]{1,240}$/.test(id)) {
    res.status(422).json({ code: 'COMMAND_ID_REQUIRED' });
    return false;
  }
  const hash = createHash('sha256')
    .update(
      JSON.stringify(canonical({ method: req.method, path: req.originalUrl, body: req.body })),
    )
    .digest('hex');
  const prior = await deps.store.claim(id, hash);
  if (prior.state !== 'started') {
    if (prior.state === 'conflict') {
      res.status(409).json({ code: 'NATIVE_IDEMPOTENCY_CONFLICT' });
      return false;
    }
    if (prior.state !== 'completed' || !prior.encryptedResponse) {
      res.status(409).json({ code: 'NATIVE_COMMAND_RECONCILIATION_REQUIRED' });
      return false;
    }
    if (!prior.expiresAt || Date.parse(prior.expiresAt) < Date.now()) {
      res.status(410).json({ code: 'NATIVE_RECEIPT_EXPIRED' });
      return false;
    }
    const value = JSON.parse(await deps.decrypt(prior.encryptedResponse)) as {
      status: number;
      type: string;
      body: string;
    };
    res.status(value.status).type(value.type).send(value.body);
    return false;
  }
  const send = res.send.bind(res);
  res.send = (body?: unknown): Response => {
    res.send = send;
    const status = res.statusCode;
    if (status >= 500) {
      send(body);
      return res;
    }
    let text = JSON.stringify(body ?? '');
    if (Buffer.isBuffer(body)) text = body.toString('utf8');
    else if (typeof body === 'string') text = body;
    if (status >= 200 && status < 300) {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        value = null;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const result = value as Record<string, unknown>;
        if (
          (typeof result.message === 'string' && /^Error\b/i.test(result.message)) ||
          (typeof result.error === 'string' && result.error.length > 0) ||
          (result.error && typeof result.error === 'object')
        ) {
          res.status(503).json({ code: 'NATIVE_OPERATION_FAILED' });
          return res;
        }
      }
    }
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
      res.status(503).json({ code: 'NATIVE_RECEIPT_TOO_LARGE' });
      return res;
    }
    void deps
      .encrypt(
        JSON.stringify({
          status,
          type: String(res.getHeader('Content-Type') ?? 'application/json'),
          body: text,
        }),
      )
      .then((encrypted) => deps.store.complete(id, hash, encrypted))
      .then(() => {
        send(body);
      })
      .catch(() => {
        if (!res.headersSent) res.status(503).json({ code: 'NATIVE_RECEIPT_PERSIST_FAILED' });
      });
    return res;
  };
  return true;
}
export function createGovernanceMutationJournal(
  deps: JournalDependencies,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next): Promise<void> => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    try {
      if (await beginGovernanceMutation(req, res, deps)) next();
    } catch {
      if (!res.headersSent) res.status(503).json({ code: 'NATIVE_JOURNAL_UNAVAILABLE' });
    }
  };
}
export type { JournalDependencies };

/** A checked operator attestation closes an ambiguous mutation without executing it again. */
export function createGovernanceJournalHandler(
  deps: JournalDependencies & {
    audit: (entry: RecordAuditEntryInput, options?: RecordAuditEntryOptions) => Promise<unknown>;
  },
): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const service = await governanceIdentity(req, 'bp:lc-admin');
      if (!service) {
        res.status(403).json({ code: 'BRIDGE_SCOPE_DENIED' });
        return;
      }
      const id = req.path.replace(/^\//, '').replace(/\/resolve$/, '');
      if (!/^[A-Za-z0-9:._-]{1,240}$/.test(id) || !deps.store.inspect) {
        res.status(422).json({ code: 'NATIVE_JOURNAL_ID_INVALID' });
        return;
      }
      const row = await deps.store.inspect(id);
      if (!row) {
        res.status(404).json({ code: 'NATIVE_COMMAND_NOT_FOUND' });
        return;
      }
      if (req.method === 'GET') {
        res.json({
          id,
          state: row.state,
          request_hash: row.requestHash,
          expires_at: row.expiresAt,
        });
        return;
      }
      const body = req.body as { resolution_id?: string; outcome?: string; evidence?: string };
      const checker = req.headers['x-checker-id'];
      const maker = String(req.headers['x-actor-id'] ?? '');
      const approval = String(req.headers['x-approval-id'] ?? '');
      const payloadHash = String(req.headers['x-approval-payload-hash'] ?? '');
      if (
        req.method !== 'POST' ||
        !req.path.endsWith('/resolve') ||
        !['applied', 'not_applied'].includes(body.outcome ?? '') ||
        typeof body.evidence !== 'string' ||
        body.evidence.length < 20 ||
        body.evidence.length > 1000 ||
        typeof body.resolution_id !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(body.resolution_id) ||
        typeof checker !== 'string' ||
        checker === maker ||
        !maker ||
        !/^[a-f0-9-]{36}$/i.test(approval) ||
        !/^[a-f0-9]{64}$/i.test(payloadHash)
      ) {
        res.status(422).json({ code: 'CHECKED_RECONCILIATION_REQUIRED' });
        return;
      }
      if (row.state === 'completed' && row.encryptedResponse) {
        const prior = JSON.parse(await deps.decrypt(row.encryptedResponse)) as { body: string };
        const resolution = JSON.parse(prior.body) as { resolution_id?: string };
        if (resolution.resolution_id === body.resolution_id) {
          res.json({ resolved: true, replayed: true });
          return;
        }
        res.status(409).json({ code: 'NATIVE_COMMAND_ALREADY_COMPLETED' });
        return;
      }
      if (row.state !== 'pending') {
        res.status(409).json({ code: 'NATIVE_COMMAND_STATE_CONFLICT' });
        return;
      }
      await deps.audit(
        {
          action: 'user.updated',
          outcome: 'pending',
          severity: 'warning',
          actor: { type: 'service', id: service.sub, name: service.name },
          target: { type: 'governance-command', id },
          metadata: {
            operation: 'manual-reconciliation',
            outcome: body.outcome ?? '',
            evidence: body.evidence,
            checkerId: checker,
            resolutionId: body.resolution_id,
          },
        },
        { failClosed: true },
      );
      await deps.store.complete(
        id,
        row.requestHash,
        await deps.encrypt(
          JSON.stringify({
            status: 409,
            type: 'application/json',
            body: JSON.stringify({
              code: 'NATIVE_COMMAND_MANUALLY_RESOLVED',
              resolution_id: body.resolution_id,
              outcome: body.outcome ?? '',
            }),
          }),
        ),
      );
      res.json({ resolved: true, outcome: body.outcome ?? '', execution_repeated: false });
    } catch {
      if (!res.headersSent) res.status(503).json({ code: 'NATIVE_RECONCILIATION_UNAVAILABLE' });
    }
  };
}
