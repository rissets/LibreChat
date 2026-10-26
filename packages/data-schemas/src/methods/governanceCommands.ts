import { Schema } from 'mongoose';
import type mongoose from 'mongoose';
interface Entry {
  _id: string;
  requestHash: string;
  state: string;
  encryptedResponse?: string;
  expiresAt: Date;
}
export interface GovernanceCommandStore {
  claim(
    id: string,
    hash: string,
  ): Promise<{ state: string; encryptedResponse?: string; expiresAt?: string }>;
  inspect?(
    id: string,
  ): Promise<{
    state: string;
    requestHash: string;
    encryptedResponse?: string;
    expiresAt: string;
  } | null>;
  complete(id: string, hash: string, encryptedResponse: string): Promise<void>;
}
/** The claim survives a process crash. An incomplete native mutation is never blindly repeated. */
export function createGovernanceCommandStore(connection: typeof mongoose): GovernanceCommandStore {
  const Model: mongoose.Model<Entry> =
    (connection.models.BpGovernanceCommand as mongoose.Model<Entry> | undefined) ||
    connection.model<Entry>(
      'BpGovernanceCommand',
      new Schema<Entry>({
        _id: { type: String, required: true },
        requestHash: { type: String, required: true },
        state: { type: String, required: true },
        encryptedResponse: String,
        expiresAt: { type: Date, required: true },
      }),
    );
  return {
    async claim(id, hash) {
      try {
        await Model.create({
          _id: id,
          requestHash: hash,
          state: 'pending',
          expiresAt: new Date(Date.now() + 30 * 86400000),
        });
        return { state: 'started' };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const row = await Model.findById(id).lean();
        if (!row) throw new Error('NATIVE_COMMAND_JOURNAL_UNAVAILABLE');
        if (row.requestHash !== hash) return { state: 'conflict' };
        return {
          state: row.state,
          encryptedResponse: row.encryptedResponse,
          expiresAt: row.expiresAt.toISOString(),
        };
      }
    },
    async inspect(id) {
      const row = await Model.findById(id).lean();
      return row
        ? {
            state: row.state,
            requestHash: row.requestHash,
            encryptedResponse: row.encryptedResponse,
            expiresAt: row.expiresAt.toISOString(),
          }
        : null;
    },
    async complete(id, hash, encryptedResponse) {
      const result = await Model.updateOne(
        { _id: id, requestHash: hash, state: 'pending' },
        { $set: { state: 'completed', encryptedResponse } },
      );
      if (result.modifiedCount !== 1) throw new Error('NATIVE_COMMAND_JOURNAL_CONFLICT');
    },
  };
}
