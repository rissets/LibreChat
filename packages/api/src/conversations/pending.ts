import { validate as validUUID } from 'uuid';
import type { RequestHandler } from 'express';
import type { ServerRequest } from '~/types';

interface PendingConversationDeps {
  getJob: (id: string) => Promise<{
    status: string;
    metadata?: { userId?: string; tenantId?: string };
  } | null>;
  getConvoOwnership: (
    userId: string,
    id: string,
    tenantId: string | null,
  ) => Promise<object | null>;
}

/** A stream has an authorized owner before its first conversation write finishes. */
export function createPendingConversationRead(
  deps: PendingConversationDeps,
  view: 'subagents' | 'queued-turns' | 'title',
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const id =
      view === 'queued-turns'
        ? req.query.conversationId
        : (req.params.parentConversationId ?? req.params.conversationId);
    const user = (req as ServerRequest).user;
    if (typeof id !== 'string' || !validUUID(id) || !user?.id) return next();
    try {
      const job = await deps.getJob(id);
      if (
        job?.status !== 'running' ||
        job.metadata?.userId !== user.id ||
        (job.metadata?.tenantId ?? null) !== (user.tenantId ?? null) ||
        (await deps.getConvoOwnership(user.id, id, user.tenantId ?? null))
      )
        return next();
      if (view === 'subagents') {
        res.json({ parentConversationId: id, children: [], childrenTruncated: false });
      } else if (view === 'title') {
        res.json({ title: 'New Chat' });
      } else {
        res.json({
          queuedTurns: [],
          capability: { supported: true, durability: 'durable', protocolVersion: 2 },
          revision: 0,
        });
      }
    } catch (error) {
      next(error);
    }
  };
}
