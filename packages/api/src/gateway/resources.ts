import { z } from 'zod';
import { withGovernanceAccess } from '@librechat/data-schemas';
import type {
  GovernanceRepository,
  RecordAuditEntryInput,
  RecordAuditEntryOptions,
} from '@librechat/data-schemas';
import type { Request, Response, NextFunction } from 'express';
import type { JournalDependencies } from './journal';
import { governanceIdentity, runGovernanceOwner } from './delegation';
import { registeredMCPTools, mcpMetadata } from './mcp';
import { beginGovernanceMutation } from './journal';
import { gatewayConfig } from './config';

const routes: Record<string, { route: string; prefix?: string; update?: string; acl?: string }> = {
  prompts: { route: 'prompts', prefix: '/groups/', acl: 'promptGroup' },
  agents: { route: 'agents/v1', acl: 'agent' },
  'remote-agents': { route: 'agents/v1', acl: 'remoteAgent' },
  memories: { route: 'memories', prefix: '/id/' },
  'mcp-servers': { route: 'mcp', prefix: '/servers/', acl: 'mcpServer' },
  skills: { route: 'skills', acl: 'skill' },
  'shared-links': { route: 'share', acl: 'sharedLink' },
  schedules: { route: 'schedules' },
  bookmarks: { route: 'tags', update: 'PUT' },
  conversations: { route: 'convos' },
  'temporary-chats': { route: 'convos' },
  'multi-conversation': { route: 'convos' },
  files: { route: 'files/files' },
  'agent-api-keys': { route: 'apiKeys' },
};
const scopeSchema = z.object({
  kind: z.string().max(80),
  owner_id: z.string().regex(/^[a-f0-9]{24}$/i),
});
interface Owner {
  _id: unknown;
  id?: string;
  openidId?: string;
  openidIssuer?: string;
  tenantId?: string;
  [key: string]: unknown;
}
interface Dependencies {
  journal: JournalDependencies;
  repository: GovernanceRepository;
  getUserById: (id: string) => Promise<Owner | null>;
  audit: (entry: RecordAuditEntryInput, options?: RecordAuditEntryOptions) => Promise<unknown>;
  invalidate: (
    kind?: string,
    id?: string,
    promptIds?: string[],
    ownerId?: string,
  ) => Promise<unknown>;
  dispatch: (route: string, req: Request, res: Response, next: NextFunction) => unknown;
}
class ResourceFailure extends Error {
  constructor(
    public code: string,
    public status = 422,
  ) {
    super(code);
  }
}
export function createGovernanceResources(
  deps: Dependencies,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const service = await governanceIdentity(req, 'bp:lc-assets');
      if (!service) {
        res.status(403).json({ code: 'BRIDGE_SCOPE_DENIED' });
        return;
      }
      if (req.method === 'GET' && req.path === '/capabilities') {
        res.json({
          version: 1,
          kinds: deps.repository.kinds.map((kind) => ({
            actions: [
              'inspect',
              'quarantine',
              'restore',
              'delete',
              ...(!['files', 'conversations', 'temporary-chats', 'multi-conversation'].includes(
                kind,
              )
                ? ['create']
                : []),
              ...(![
                'files',
                'conversations',
                'temporary-chats',
                'multi-conversation',
                'agent-api-keys',
              ].includes(kind)
                ? ['update']
                : []),
              ...(routes[kind]?.acl ? ['acl'] : []),
              ...(kind === 'prompts' ? ['save-version', 'publish-version'] : []),
              ...(kind === 'schedules' ? ['run'] : []),
            ],
            kind,
            metadata: true,
            quarantine: true,
            lifecycle: 'native-controller',
            acl: !!routes[kind]?.acl,
          })),
          configuration_families: ['PEOPLE_PICKER'],
        });
        return;
      }
      const parsed = scopeSchema.safeParse(
        req.method === 'GET' || req.path === '/upload' ? req.query : req.body,
      );
      if (!parsed.success) throw new ResourceFailure('INVALID_RESOURCE_SCOPE');
      const { kind, owner_id: ownerId } = parsed.data;
      const owner = await deps.getUserById(ownerId);
      if (!owner || owner.openidIssuer !== gatewayConfig()?.issuer || !owner.openidId)
        throw new ResourceFailure('OWNER_NOT_FOUND', 404);
      if (req.path === '/upload' && req.method === 'POST' && kind === 'files') {
        await deps.audit(
          {
            action: 'user.updated',
            outcome: 'pending',
            severity: 'warning',
            actor: { type: 'service', id: service.sub, name: service.name },
            target: { type: 'files' },
            metadata: {
              operation: 'managed-file-upload',
              ownerId,
              actorId: String(req.headers['x-actor-id'] ?? ''),
            },
          },
          { failClosed: true },
        );
        req.url = '/';
        withGovernanceAccess(() =>
          runGovernanceOwner(req, owner, () => deps.dispatch('files-upload', req, res, next)),
        );
        return;
      }
      if (
        req.method === 'POST' &&
        req.path === '/commands' &&
        !(await beginGovernanceMutation(req, res, deps.journal))
      )
        return;
      if (!deps.repository.kinds.includes(kind))
        throw new ResourceFailure('RESOURCE_KIND_NOT_SUPPORTED', 404);
      if (req.method === 'GET' && req.path === '/') {
        const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
        const after = String(req.query.after ?? '');
        if (after && !/^[a-f0-9]{24}$/i.test(after)) throw new ResourceFailure('INVALID_CURSOR');
        const rows = await deps.repository.list(kind, ownerId, owner.tenantId, after, limit + 1);
        res.json({
          kind,
          resources: rows.slice(0, limit),
          next_cursor: rows.length > limit ? rows[limit - 1]._id : null,
        });
        return;
      }
      if (req.method === 'GET' && req.path === '/mcp') {
        const id = String(req.query.resource_id ?? '');
        const operation = String(req.query.operation ?? '');
        if (
          kind !== 'mcp-servers' ||
          !id ||
          id.length > 200 ||
          !['tools', 'status'].includes(operation)
        )
          throw new ResourceFailure('MCP_OPERATION_NOT_SUPPORTED', 422);
        const row = await deps.repository.get(kind, ownerId, owner.tenantId, id);
        if (!row) throw new ResourceFailure('RESOURCE_NOT_FOUND', 404);
        if (row.governanceQuarantined) {
          res.json({
            serverName: id,
            disabled: true,
            tools: [],
            tool_count: 0,
            connectionStatus: 'disabled',
          });
          return;
        }
        await deps.audit(
          {
            action: 'user.updated',
            outcome: 'pending',
            severity: 'info',
            actor: { type: 'service', id: service.sub, name: service.name },
            target: { type: kind, id },
            metadata: { operation: 'mcp-metadata-' + operation, ownerId },
          },
          { failClosed: true },
        );
        if (operation === 'tools') {
          res.json(registeredMCPTools(row, id));
          return;
        }
        const json = res.json.bind(res);
        res.json = (value: unknown): Response => {
          const projected = mcpMetadata(value, id);
          if (!projected || res.statusCode >= 400) {
            res.status(503);
            return json({ code: 'MCP_METADATA_UNAVAILABLE' });
          }
          return json(projected);
        };
        req.url = '/connection/status/' + encodeURIComponent(id);
        withGovernanceAccess(() =>
          runGovernanceOwner(req, owner, () => deps.dispatch('mcp', req, res, next)),
        );
        return;
      }
      if (req.method === 'GET' && req.path === '/versions') {
        const id = String(req.query.resource_id ?? '');
        const after = String(req.query.after ?? '');
        if (
          kind !== 'prompts' ||
          !/^[a-f0-9]{24}$/i.test(id) ||
          (after && !/^[a-f0-9]{24}$/i.test(after)) ||
          !deps.repository.promptVersions
        )
          throw new ResourceFailure('PROMPT_VERSIONS_NOT_SUPPORTED', 422);
        const group = await deps.repository.get(kind, ownerId, owner.tenantId, id);
        if (!group) throw new ResourceFailure('RESOURCE_NOT_FOUND', 404);
        const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
        const rows = await deps.repository.promptVersions(
          id,
          ownerId,
          owner.tenantId,
          after,
          limit + 1,
        );
        res.json({
          versions: rows
            .slice(0, limit)
            .map((row) => ({ ...row, production: row.id === String(group.productionId) })),
          next_cursor: rows.length > limit ? rows[limit - 1].id : null,
        });
        return;
      }
      if (req.method === 'GET' && req.path === '/schedule-runs') {
        const scheduleId = String(req.query.schedule_id ?? '');
        if (
          kind !== 'schedules' ||
          !scheduleId ||
          scheduleId.length > 200 ||
          !deps.repository.scheduleRuns
        )
          throw new ResourceFailure('SCHEDULE_HISTORY_NOT_SUPPORTED', 422);
        const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
        res.json({
          runs: await deps.repository.scheduleRuns(ownerId, owner.tenantId, scheduleId, limit),
        });
        return;
      }
      if (req.method === 'GET' && req.path === '/access') {
        const id = String(req.query.resource_id ?? '');
        if (!id || id.length > 200 || !routes[kind]?.acl)
          throw new ResourceFailure('RESOURCE_ACL_NOT_SUPPORTED', 422);
        const row = await deps.repository.get(kind, ownerId, owner.tenantId, id);
        if (!row) throw new ResourceFailure('RESOURCE_NOT_FOUND', 404);
        await deps.audit(
          {
            action: 'user.updated',
            outcome: 'pending',
            severity: 'info',
            actor: { type: 'service', id: service.sub, name: service.name },
            target: { type: kind, id },
            metadata: {
              operation: 'acl-read',
              ownerId,
              actorId: String(req.headers['x-actor-id'] ?? ''),
            },
          },
          { failClosed: true },
        );
        req.url =
          '/' +
          routes[kind].acl +
          '/' +
          (req.query.roles === 'true' ? 'roles' : encodeURIComponent(String(row._id)));
        withGovernanceAccess(() =>
          runGovernanceOwner(req, owner, () => deps.dispatch('accessPermissions', req, res, next)),
        );
        return;
      }
      const input = req.body as {
        action?: string;
        resource_id?: string;
        purpose?: string;
        data?: Record<string, unknown>;
      };
      if (
        input.resource_id &&
        (typeof input.resource_id !== 'string' || input.resource_id.length > 200)
      )
        throw new ResourceFailure('INVALID_RESOURCE_ID');
      const audit = async () =>
        deps.audit(
          {
            action: 'user.updated',
            outcome: 'pending',
            severity: 'warning',
            actor: { type: 'service', id: service.sub, name: service.name },
            target: { type: kind, id: input.resource_id },
            metadata: {
              operation: input.action ?? 'inspect',
              ownerId,
              commandId: String(req.headers['x-command-id'] ?? ''),
              actorId: String(req.headers['x-actor-id'] ?? ''),
              purpose: input.purpose ?? '',
            },
          },
          { failClosed: true },
        );
      if (req.path === '/inspect' && req.method === 'POST') {
        if (typeof input.purpose !== 'string' || input.purpose.length < 20)
          throw new ResourceFailure('CONTENT_PURPOSE_REQUIRED');
        await audit();
        const row = await deps.repository.get(
          kind,
          ownerId,
          owner.tenantId,
          input.resource_id ?? '',
          true,
        );
        if (!row) throw new ResourceFailure('RESOURCE_NOT_FOUND', 404);
        res.json({ resource: row });
        return;
      }
      if (req.path !== '/commands' || req.method !== 'POST')
        throw new ResourceFailure('RESOURCE_ROUTE_NOT_FOUND', 404);
      if (
        ![
          'create',
          'update',
          'delete',
          'quarantine',
          'restore',
          'acl',
          'save-version',
          'publish-version',
          'run',
        ].includes(input.action ?? '')
      )
        throw new ResourceFailure('INVALID_RESOURCE_ACTION');
      const row = input.resource_id
        ? await deps.repository.get(kind, ownerId, owner.tenantId, input.resource_id)
        : null;
      if (input.action !== 'create' && !row) throw new ResourceFailure('RESOURCE_NOT_FOUND', 404);
      const revision = Number(row?.governanceRevision ?? 0);
      if (input.data?.expected_revision != null && input.data.expected_revision !== revision)
        throw new ResourceFailure('REVISION_CONFLICT', 409);
      await audit();
      if (input.action === 'quarantine' || input.action === 'restore') {
        const changed = await deps.repository.quarantine(
          kind,
          ownerId,
          owner.tenantId,
          input.resource_id ?? '',
          input.action === 'quarantine',
          revision,
        );
        if (!changed) throw new ResourceFailure('REVISION_CONFLICT', 409);
        const promptIds =
          kind === 'prompts' && deps.repository.promptIds
            ? await deps.repository.promptIds(input.resource_id ?? '', ownerId, owner.tenantId)
            : [];
        await deps.invalidate(kind, input.resource_id, promptIds, ownerId);
        res.json({
          resource_id: input.resource_id,
          quarantined: input.action === 'quarantine',
          revision: revision + 1,
        });
        return;
      }
      const descriptor = routes[kind];
      let route = descriptor.route;
      let path = (descriptor.prefix ?? '/') + encodeURIComponent(input.resource_id ?? '');
      let method = descriptor.update ?? 'PATCH';
      if (input.action === 'create') method = 'POST';
      if (input.action === 'delete') method = 'DELETE';
      let data = { ...(input.data ?? {}) };
      delete data.expected_revision;
      if (input.action === 'create') {
        path = kind === 'mcp-servers' ? '/servers' : '/';
        if (kind === 'shared-links') {
          if (typeof data.conversationId !== 'string')
            throw new ResourceFailure('CONVERSATION_ID_REQUIRED');
          path = '/' + encodeURIComponent(data.conversationId);
          delete data.conversationId;
        }
      }
      if (input.action === 'save-version') {
        if (kind !== 'prompts') throw new ResourceFailure('RESOURCE_ACTION_NOT_SUPPORTED');
        path = '/groups/' + encodeURIComponent(input.resource_id ?? '') + '/prompts';
        method = 'POST';
      }
      if (input.action === 'publish-version') {
        if (
          kind !== 'prompts' ||
          !deps.repository.promptIds ||
          typeof data.prompt_id !== 'string' ||
          !(
            await deps.repository.promptIds(input.resource_id ?? '', ownerId, owner.tenantId)
          ).includes(data.prompt_id)
        )
          throw new ResourceFailure('PROMPT_VERSION_NOT_OWNED', 422);
        path = '/' + encodeURIComponent(data.prompt_id) + '/tags/production';
        method = 'PATCH';
        data = {};
      }
      if (input.action === 'run') {
        if (kind !== 'schedules') throw new ResourceFailure('RESOURCE_ACTION_NOT_SUPPORTED');
        path = '/' + encodeURIComponent(input.resource_id ?? '') + '/run';
        method = 'POST';
      }
      if (input.action === 'acl') {
        if (!descriptor.acl) throw new ResourceFailure('RESOURCE_ACL_NOT_SUPPORTED');
        route = 'accessPermissions';
        path = '/' + descriptor.acl + '/' + encodeURIComponent(String(row?._id));
        method = 'PUT';
      }
      if (kind === 'files') {
        if (input.action !== 'delete')
          throw new ResourceFailure('FILE_MUTATION_REQUIRES_UPLOAD_PROTOCOL');
        path = '/';
        data = { files: [row] };
      }
      if (['conversations', 'temporary-chats', 'multi-conversation'].includes(kind)) {
        if (input.action !== 'delete') throw new ResourceFailure('USE_CONVERSATION_LIFECYCLE');
        path = '/';
        data = { arg: { conversationId: row?.conversationId } };
      }
      req.method = method;
      req.url = path;
      req.body = data;
      withGovernanceAccess(() =>
        runGovernanceOwner(req, owner, () => deps.dispatch(route, req, res, next)),
      );
    } catch (error) {
      res.status(error instanceof ResourceFailure ? error.status : 503).json({
        code: error instanceof ResourceFailure ? error.code : 'RESOURCE_OPERATION_UNAVAILABLE',
      });
    }
  };
}
