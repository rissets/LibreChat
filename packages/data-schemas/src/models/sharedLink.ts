import { applyGovernance } from '~/models/plugins/governance';
import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import shareSchema, { ISharedLink } from '~/schema/share';

export function createSharedLinkModel(mongoose: typeof import('mongoose')): Model<ISharedLink> {
  applyGovernance(shareSchema);
  applyTenantIsolation(shareSchema);
  return mongoose.models.SharedLink || mongoose.model<ISharedLink>('SharedLink', shareSchema);
}
