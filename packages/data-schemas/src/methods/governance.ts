import type mongoose from 'mongoose';
import { withGovernanceAccess } from '~/models/plugins/governance';
import type { AclEntryMethods } from './aclEntry';
import type { createUserGroupMethods } from './userGroup';
export type GovernanceRecord = Record<string, unknown>;
interface Descriptor {
  model: string;
  owner: string;
  id: string;
  filter?: object;
}
const descriptors: Record<string, Descriptor> = {
  prompts: { model: 'PromptGroup', owner: 'author', id: '_id' },
  agents: { model: 'Agent', owner: 'author', id: 'id' },
  'remote-agents': { model: 'Agent', owner: 'author', id: 'id' },
  memories: { model: 'MemoryEntry', owner: 'userId', id: '_id' },
  'mcp-servers': { model: 'MCPServer', owner: 'author', id: 'serverName' },
  skills: { model: 'Skill', owner: 'author', id: '_id' },
  'shared-links': { model: 'SharedLink', owner: 'user', id: 'shareId' },
  schedules: { model: 'Schedule', owner: 'user', id: 'id' },
  bookmarks: { model: 'ConversationTag', owner: 'user', id: 'tag' },
  conversations: { model: 'Conversation', owner: 'user', id: 'conversationId' },
  'temporary-chats': {
    model: 'Conversation',
    owner: 'user',
    id: 'conversationId',
    filter: { isTemporary: true },
  },
  'multi-conversation': {
    model: 'Conversation',
    owner: 'user',
    id: 'conversationId',
    // Multi-conversation panes are browser state; governance manages their underlying conversations.
  },
  files: { model: 'File', owner: 'user', id: 'file_id' },
  'agent-api-keys': { model: 'AgentApiKey', owner: 'userId', id: '_id' },
};
const projection =
  '_id id name title description version serverName tag file_id bytes type provider model tools endpoint conversationId shareId createdAt updatedAt created_at updated_at enabled isTemporary remoteGovernanceDisabled governanceQuarantined governanceRevision governanceDisabledFor productionId numberOfGenerations deletingAt deleting agent_id cadence timezone nextRunAt disabledReason runCount failureCount lastRun.status lastRun.conversationId lastRun.firedAt lastRun.scheduledFor';
const aclKinds: Record<string, string> = {
  agents: 'agent',
  skills: 'skill',
  prompts: 'promptGroup',
  'mcp-servers': 'mcpServer',
  'remote-agents': 'remoteAgent',
  'shared-links': 'sharedLink',
};
type Sharing = Pick<
  AclEntryMethods,
  'grantPermission' | 'deleteAclEntries' | 'findAccessibleResources'
> &
  Pick<ReturnType<typeof createUserGroupMethods>, 'getUserPrincipals' | 'upsertGroupByExternalId'>;
export interface GovernanceRepository {
  available?(
    kind: string,
    userId: string,
    tenantId: string | undefined,
    after: string,
    limit: number,
  ): Promise<GovernanceRecord[]>;
  assign?(
    kind: string,
    ownerId: string,
    tenantId: string | undefined,
    id: string,
    policyId: string,
    memberIds: string[],
    active: boolean,
  ): Promise<void>;
  userState?(
    kind: string,
    ownerId: string,
    tenantId: string | undefined,
    id: string,
    userId: string,
    enabled: boolean,
    revision: number,
  ): Promise<boolean>;
  list(
    kind: string,
    ownerId: string,
    tenantId: string | undefined,
    after: string,
    limit: number,
  ): Promise<GovernanceRecord[]>;
  get(
    kind: string,
    ownerId: string,
    tenantId: string | undefined,
    id: string,
    content?: boolean,
  ): Promise<GovernanceRecord | null>;
  quarantine(
    kind: string,
    ownerId: string,
    tenantId: string | undefined,
    id: string,
    value: boolean,
    revision: number,
  ): Promise<boolean>;
  promptVersions?(
    groupId: string,
    ownerId: string,
    tenantId: string | undefined,
    after: string,
    limit: number,
  ): Promise<GovernanceRecord[]>;
  scheduleRuns?(
    ownerId: string,
    tenantId: string | undefined,
    scheduleId: string,
    limit: number,
  ): Promise<GovernanceRecord[]>;
  promptIds?(groupId: string, ownerId: string, tenantId?: string): Promise<string[]>;
  kinds: string[];
}
export function createGovernanceRepository(
  connection: typeof mongoose,
  sharing?: Sharing,
): GovernanceRepository {
  function scope(kind: string, ownerId: string, tenantId?: string) {
    const d = descriptors[kind];
    if (!d) throw new Error('GOVERNANCE_KIND_INVALID');
    const model = connection.models[d.model];
    if (!model) throw new Error('GOVERNANCE_MODEL_UNAVAILABLE');
    return {
      d,
      model,
      filter: { [d.owner]: ownerId, ...(tenantId ? { tenantId } : {}), ...d.filter },
    };
  }
  return {
    kinds: Object.keys(descriptors),
    async available(kind, userId, tenantId, after, limit) {
      const { d, model } = scope(kind, userId, tenantId);
      const ids =
        sharing && aclKinds[kind]
          ? await sharing.findAccessibleResources(
              await sharing.getUserPrincipals({ userId }),
              aclKinds[kind],
              1,
            )
          : [];
      const rows = await withGovernanceAccess(() =>
        model
          .find({
            ...(tenantId ? { tenantId } : {}),
            ...d.filter,
            $or: [{ [d.owner]: userId }, { _id: { $in: ids } }],
            ...(after ? { _id: { $gt: after } } : {}),
          })
          .select(projection + ' ' + d.owner)
          .sort({ _id: 1 })
          .limit(limit)
          .lean()
          .exec(),
      );
      return (rows as GovernanceRecord[]).map((row) => ({
        ...row,
        _id: String(row._id),
        resource_id: String(row[d.id]),
        owner_id: String(row[d.owner]),
        user_enabled: !(row.governanceDisabledFor as string[] | undefined)?.includes(userId),
        lifecycle_state: row.deletingAt || row.deleting ? 'deleting' : 'active',
      }));
    },
    async assign(kind, ownerId, tenantId, id, policyId, memberIds, active) {
      if (!sharing || !aclKinds[kind]) throw new Error('RESOURCE_ASSIGNMENT_UNAVAILABLE');
      const { d, model, filter } = scope(kind, ownerId, tenantId);
      const row = (await withGovernanceAccess(() =>
        model
          .findOne({ ...filter, [d.id]: id })
          .lean()
          .exec(),
      )) as GovernanceRecord | null;
      if (!row) throw new Error('RESOURCE_NOT_FOUND');
      const members = await connection.models.User.find({
        _id: { $in: memberIds },
        ...(tenantId ? { tenantId } : {}),
      })
        .select('idOnTheSource')
        .lean()
        .exec();
      if (members.length !== memberIds.length) throw new Error('ASSIGNMENT_MEMBER_INVALID');
      const group = await sharing.upsertGroupByExternalId('bpbatam:asset:' + policyId, 'local', {
        name: 'Akses aset ' + String(row.name ?? row.title ?? id),
        description: 'Dikelola melalui Control Panel. ' + policyId,
        memberIds: active ? members.map((m) => String(m.idOnTheSource || m._id)) : [],
        ...(tenantId ? { tenantId } : {}),
      });
      if (!group) throw new Error('ASSIGNMENT_GROUP_UNAVAILABLE');
      if (active)
        await sharing.grantPermission(
          'group',
          group._id,
          aclKinds[kind],
          String(row._id),
          1,
          ownerId,
        );
      else
        await sharing.deleteAclEntries({
          principalType: 'group',
          principalId: group._id,
          resourceType: aclKinds[kind],
          resourceId: row._id,
        });
    },
    async userState(kind, ownerId, tenantId, id, userId, enabled, revision) {
      const { d, model, filter } = scope(kind, ownerId, tenantId);
      const result = await withGovernanceAccess(() =>
        model
          .updateOne(
            {
              ...filter,
              [d.id]: id,
              ...(revision === 0
                ? { $or: [{ governanceRevision: 0 }, { governanceRevision: { $exists: false } }] }
                : { governanceRevision: revision }),
            },
            {
              [enabled ? '$pull' : '$addToSet']: { governanceDisabledFor: userId },
              $inc: { governanceRevision: 1 },
            },
          )
          .exec(),
      );
      return result.modifiedCount === 1;
    },
    async promptVersions(groupId, ownerId, tenantId, after, limit) {
      const rows = await withGovernanceAccess(() =>
        connection.models.Prompt.find({
          groupId,
          author: ownerId,
          ...(tenantId ? { tenantId } : {}),
          ...(after ? { _id: { $lt: after } } : {}),
        })
          .select('_id type createdAt updatedAt')
          .sort({ _id: -1 })
          .limit(limit)
          .lean()
          .exec(),
      );
      return rows.map((row: GovernanceRecord) => ({ ...row, id: String(row._id) }));
    },
    async scheduleRuns(ownerId, tenantId, scheduleId, limit) {
      return connection.models.ScheduleRun.find({
        user: ownerId,
        scheduleId,
        ...(tenantId ? { tenantId } : {}),
      })
        .select(
          '_id scheduleId scheduledFor firedAt conversationId status completedAt reconciledAt mcp.status mcp.reason mcp.server',
        )
        .sort({ firedAt: -1, _id: -1 })
        .limit(limit)
        .lean()
        .exec();
    },
    async promptIds(groupId, ownerId, tenantId) {
      const rows = await withGovernanceAccess(() =>
        connection.models.Prompt.find({
          groupId,
          author: ownerId,
          ...(tenantId ? { tenantId } : {}),
        })
          .select('_id')
          .lean()
          .exec(),
      );
      return rows.map((row: { _id: unknown }) => String(row._id));
    },
    async list(kind, ownerId, tenantId, after, limit) {
      const { d, model, filter } = scope(kind, ownerId, tenantId);
      const rows = await withGovernanceAccess(() =>
        model
          .find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) })
          .select(projection)
          .sort({ _id: 1 })
          .limit(limit)
          .lean()
          .exec(),
      );
      return (rows as GovernanceRecord[]).map((row) => ({
        ...row,
        _id: String(row._id),
        resource_id: String(row[d.id]),
        ...(kind === 'remote-agents'
          ? {
              governanceQuarantined:
                row.remoteGovernanceDisabled === true || row.governanceQuarantined === true,
              exposure: 'remote-api',
            }
          : {}),
        owner_id: ownerId,
        lifecycle_state: row.deletingAt || row.deleting ? 'deleting' : 'active',
      }));
    },
    async get(kind, ownerId, tenantId, id, content = false) {
      const { d, model, filter } = scope(kind, ownerId, tenantId);
      const row = await withGovernanceAccess(() =>
        model
          .findOne({ ...filter, [d.id]: id })
          .select(
            content
              ? '-keyHash -config.oauth -config.headers +governanceDisabledFor'
              : '+governanceDisabledFor',
          )
          .lean()
          .exec(),
      );
      if (!row || !content) return row as GovernanceRecord | null;
      const record = row as GovernanceRecord;
      if (kind === 'prompts') {
        record.versions = await withGovernanceAccess(() =>
          connection.models.Prompt.find({
            groupId: record._id,
            author: ownerId,
            ...(tenantId ? { tenantId } : {}),
          })
            .select('_id prompt type createdAt updatedAt')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
            .exec(),
        );
      }
      if (['conversations', 'temporary-chats', 'multi-conversation'].includes(kind)) {
        record.messages = await withGovernanceAccess(() =>
          connection.models.Message.find({
            conversationId: record.conversationId,
            user: ownerId,
            ...(tenantId ? { tenantId } : {}),
          })
            .select('messageId parentMessageId sender text content createdAt endpoint model')
            .sort({ createdAt: 1 })
            .limit(500)
            .lean()
            .exec(),
        );
        record.inspection_message_limit = 500;
      }
      return record;
    },
    async quarantine(kind, ownerId, tenantId, id, value, revision) {
      const { d, model, filter } = scope(kind, ownerId, tenantId);
      const result = await withGovernanceAccess(() =>
        model
          .updateOne(
            {
              ...filter,
              [d.id]: id,
              ...(revision === 0
                ? { $or: [{ governanceRevision: 0 }, { governanceRevision: { $exists: false } }] }
                : { governanceRevision: revision }),
            },
            {
              $set: {
                [kind === 'remote-agents' ? 'remoteGovernanceDisabled' : 'governanceQuarantined']:
                  value,
              },
              $inc: { governanceRevision: 1 },
            },
          )
          .exec(),
      );
      return result.modifiedCount === 1;
    },
  };
}
