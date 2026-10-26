import { applyGovernance } from '~/models/plugins/governance';
import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agentApiKeySchema, { IAgentApiKey } from '~/schema/agentApiKey';

export function createAgentApiKeyModel(mongoose: typeof import('mongoose')): Model<IAgentApiKey> {
  applyGovernance(agentApiKeySchema);
  applyTenantIsolation(agentApiKeySchema);
  return (
    mongoose.models.AgentApiKey || mongoose.model<IAgentApiKey>('AgentApiKey', agentApiKeySchema)
  );
}
