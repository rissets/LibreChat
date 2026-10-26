import { randomUUID } from 'node:crypto';
import { Schema } from 'mongoose';
import type mongoose from 'mongoose';
export interface GovernanceFeed {
  version: number;
  instance_id: string;
  next_cursor: string;
  events: Array<{ id: string; kind: string; created_at: string; payload: Record<string, string> }>;
}
export function createGovernanceEventReader(
  connection: typeof mongoose,
): (after: number, limit: number) => Promise<GovernanceFeed> {
  const State: mongoose.Model<{ _id: string; value: string }> =
    (connection.models.BpGovernanceState as
      | mongoose.Model<{ _id: string; value: string }>
      | undefined) ||
    connection.model<{ _id: string; value: string }>(
      'BpGovernanceState',
      new Schema<{ _id: string; value: string }>({
        _id: { type: String, required: true },
        value: { type: String, required: true },
      }),
    );
  return async (after, limit) => {
    const state = await State.findOneAndUpdate(
      { _id: 'instance' },
      { $setOnInsert: { value: randomUUID() } },
      { upsert: true, new: true },
    ).lean();
    if (!state) throw new Error('GOVERNANCE_INSTANCE_UNAVAILABLE');
    const rows = await connection.models.AuditLog.find({
      chainKey: '__platform__',
      seq: { $gt: after },
    })
      .sort({ seq: 1 })
      .limit(limit)
      .select('_id seq hash prevHash action outcome severity actor target metadata createdAt')
      .lean();
    return {
      version: 1,
      instance_id: state.value,
      next_cursor: String(rows[rows.length - 1]?.seq ?? after),
      events: rows.map((row) => {
        const payload: Record<string, string> = {
          sequence: String(row.seq),
          hash: String(row.hash),
          previous_hash: String(row.prevHash),
          action: String(row.action),
          outcome: String(row.outcome),
          severity: String(row.severity),
          actor_id: String(row.actor?.id ?? ''),
          target_type: String(row.target?.type ?? ''),
          target_id: String(row.target?.id ?? ''),
        };
        for (const [key, native] of [
          ['owner_id', 'ownerId'],
          ['command_id', 'commandId'],
          ['capability', 'capability'],
        ]) {
          const value = row.metadata?.[native];
          if (typeof value === 'string') payload[key] = value.slice(0, 200);
        }
        return {
          id: String(row._id),
          kind: 'librechat.' + row.action,
          created_at: new Date(row.createdAt).toISOString(),
          payload,
        };
      }),
    };
  };
}
