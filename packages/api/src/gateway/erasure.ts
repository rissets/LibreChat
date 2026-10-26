import { withGovernanceAccess } from '@librechat/data-schemas';
import type { RecordAuditEntryInput, RecordAuditEntryOptions } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { governanceIdentity, runGovernanceOwner } from './delegation';
import { gatewayConfig } from './config';
const verified = new WeakSet<object>();
export function requiresSelfServiceErasure(req: object, twoFactorEnabled: boolean): boolean {
  return twoFactorEnabled && !verified.has(req);
}
interface ErasureOwner {
  _id: unknown;
  id?: string;
  openidId?: string;
  openidIssuer?: string;
  [key: string]: unknown;
}
export function createGovernanceErasure(deps: {
  getUserById: (id: string) => Promise<ErasureOwner | null>;
  audit: (input: RecordAuditEntryInput, options?: RecordAuditEntryOptions) => Promise<unknown>;
  erase: (req: Request, res: Response) => Promise<unknown>;
}): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      const identity = await governanceIdentity(req, 'bp:lc-users');
      const approval = String(req.headers['x-approval-id'] ?? '');
      const hash = String(req.headers['x-approval-payload-hash'] ?? '');
      const checker = String(req.headers['x-checker-id'] ?? '');
      const maker = String(req.headers['x-actor-id'] ?? '');
      if (
        !identity ||
        !approval ||
        !/^[a-f0-9]{64}$/i.test(hash) ||
        !checker ||
        checker === maker
      ) {
        res.status(403).json({ code: 'APPROVED_ERASURE_REQUIRED' });
        return;
      }
      const input = req.body as { userId?: string; subject?: string; issuer?: string };
      if (
        typeof input.userId !== 'string' ||
        !/^[a-f0-9]{24}$/i.test(input.userId) ||
        input.issuer !== gatewayConfig()?.issuer
      ) {
        res.status(422).json({ code: 'INVALID_ERASURE_IDENTITY' });
        return;
      }
      const owner = await deps.getUserById(input.userId);
      if (!owner) {
        res.json({ erased: true, already_absent: true });
        return;
      }
      if (owner.openidId !== input.subject || owner.openidIssuer !== input.issuer) {
        res.status(409).json({ code: 'ERASURE_SUBJECT_MISMATCH' });
        return;
      }
      await deps.audit(
        {
          action: 'user.updated',
          outcome: 'pending',
          severity: 'critical',
          actor: { type: 'service', id: identity.sub, name: identity.name },
          target: { type: 'user', id: input.userId },
          metadata: {
            operation: 'approved-managed-user-erasure',
            maker,
            checker,
            approvalId: approval,
            payloadHash: hash,
            commandId: String(req.headers['x-command-id'] ?? ''),
          },
        },
        { failClosed: true },
      );
      verified.add(req);
      req.body = {};
      await withGovernanceAccess(() => runGovernanceOwner(req, owner, () => deps.erase(req, res)));
    } catch {
      if (!res.headersSent) res.status(503).json({ code: 'USER_ERASURE_UNAVAILABLE' });
    }
  };
}
