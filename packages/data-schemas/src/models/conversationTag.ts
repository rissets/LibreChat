import { applyGovernance } from '~/models/plugins/governance';
import { Model } from 'mongoose';
import conversationTagSchema, { IConversationTag } from '~/schema/conversationTag';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createConversationTagModel(
  mongoose: typeof import('mongoose'),
): Model<IConversationTag> {
  applyGovernance(conversationTagSchema);
  applyTenantIsolation(conversationTagSchema);
  return (
    mongoose.models.ConversationTag ||
    mongoose.model<IConversationTag>('ConversationTag', conversationTagSchema)
  );
}
