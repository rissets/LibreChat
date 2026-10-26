import { applyGovernance } from '~/models/plugins/governance';
import { Model } from 'mongoose';
import type { IPrompt } from '~/types/prompts';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import promptSchema from '~/schema/prompt';

export function createPromptModel(mongoose: typeof import('mongoose')): Model<IPrompt> {
  applyGovernance(promptSchema);
  applyTenantIsolation(promptSchema);
  return mongoose.models.Prompt || mongoose.model<IPrompt>('Prompt', promptSchema);
}
