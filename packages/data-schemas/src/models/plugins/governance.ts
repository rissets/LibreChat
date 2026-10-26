import { AsyncLocalStorage } from 'node:async_hooks';
import { Schema } from 'mongoose';
const access = new AsyncLocalStorage<boolean>();
const installed = new WeakSet<Schema>();
/** Only the authenticated owner-side governance service can include quarantined resources. */
export function withGovernanceAccess<T>(fn: () => T): T {
  return access.run(true, fn);
}
export function applyGovernance(schema: Schema): void {
  if (installed.has(schema)) return;
  installed.add(schema);
  schema.add({
    governanceQuarantined: { type: Boolean, default: false, index: true },
    governanceRevision: { type: Number, default: 0 },
  });
  schema.pre(
    [
      'find',
      'findOne',
      'countDocuments',
      'findOneAndUpdate',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
    ],
    function () {
      if (!access.getStore()) this.where({ governanceQuarantined: { $ne: true } });
    },
  );
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
    const update = this.getUpdate();
    const protectedFields = new Set([
      'governanceQuarantined',
      'governanceRevision',
      'remoteGovernanceDisabled',
    ]);
    if (!access.getStore() && update && !Array.isArray(update)) {
      for (const [operator, values] of Object.entries(update)) {
        if (protectedFields.has(operator)) {
          delete update[operator];
          continue;
        }
        if (values && typeof values === 'object')
          for (const [field, target] of Object.entries(values)) {
            if (
              protectedFields.has(field.split('.')[0]) ||
              (operator === '$rename' &&
                typeof target === 'string' &&
                protectedFields.has(target.split('.')[0]))
            )
              delete values[field];
          }
      }
    }
    if (update && !Array.isArray(update)) {
      update.$inc = { ...update.$inc, governanceRevision: update.$inc?.governanceRevision ?? 1 };
      this.setUpdate(update);
    }
  });
  schema.pre('save', function () {
    if (access.getStore()) return;
    for (const field of ['governanceQuarantined', 'remoteGovernanceDisabled']) {
      if (this.isNew) this.set(field, false);
      else if (this.isModified(field)) throw new Error('GOVERNANCE_FIELD_WRITE_FORBIDDEN');
    }
  });
  schema.pre('aggregate', function () {
    if (!access.getStore())
      this.pipeline().unshift({ $match: { governanceQuarantined: { $ne: true } } });
  });
}
