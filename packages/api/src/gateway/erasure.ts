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
  findUserByIdentity: (subject: string, issuer: string) => Promise<ErasureOwner | null>;
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
      // Only the authenticated governance service can attest a CP admin decision.
      const directAdmin = req.headers['x-approval-mode'] === 'admin-direct';
      if (
        !identity ||
        !approval ||
        !/^[a-f0-9]{64}$/i.test(hash) ||
        !maker ||
        !checker ||
        (checker === maker && !directAdmin)
      ) {
        res.status(403).json({ code: 'APPROVED_ERASURE_REQUIRED' });
        return;
      }
      const input = req.body as { userId?: string; subject?: string; issuer?: string };
      if (
        (input.userId != null &&
          (typeof input.userId !== 'string' || !/^[a-f0-9]{24}$/i.test(input.userId))) ||
        typeof input.subject !== 'string' ||
        !input.subject ||
        typeof input.issuer !== 'string' ||
        input.issuer !== gatewayConfig()?.issuer
      ) {
        res.status(422).json({ code: 'INVALID_ERASURE_IDENTITY' });
        return;
      }
      const owner = input.userId
        ? await deps.getUserById(input.userId)
        : await deps.findUserByIdentity(input.subject, input.issuer);
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
          target: { type: 'user', id: String(owner._id) },
          metadata: {
            operation: 'approved-managed-user-erasure',
            maker,
            checker,
            approvalMode: directAdmin ? 'admin-direct' : 'independent',
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
