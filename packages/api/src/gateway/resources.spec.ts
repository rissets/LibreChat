import type { Request, Response } from 'express';
import { createGovernanceResources } from './resources';
import { governanceIdentity } from './delegation';
import { beginGovernanceMutation } from './journal';
import type { GovernanceRepository } from '@librechat/data-schemas';
jest.mock('./delegation', () => ({ governanceIdentity: jest.fn(), runGovernanceOwner: jest.fn() }));
jest.mock('./journal', () => ({ beginGovernanceMutation: jest.fn() }));
jest.mock('./config', () => ({ gatewayConfig: () => ({ issuer: 'https://identity.test' }) }));
const owner = '000000000000000000000001';
const user = '000000000000000000000002';
function setup() {
  jest.mocked(governanceIdentity).mockResolvedValue({ sub: 'cp', name: 'control' });
  jest.mocked(beginGovernanceMutation).mockResolvedValue(true);
  const repository = {
    kinds: ['skills'],
    get: jest.fn(async () => ({
      _id: '000000000000000000000003',
      governanceRevision: 3,
      deletingAt: null as Date | null,
    })),
    assign: jest.fn(async () => undefined),
    userState: jest.fn(async (): Promise<boolean> => true),
    list: jest.fn(),
    quarantine: jest.fn(),
  } satisfies GovernanceRepository;
  const invalidate = jest.fn(async () => undefined);
  const audit = jest.fn(async () => undefined);
  const handler = createGovernanceResources({
    repository,
    invalidate,
    audit,
    journal: {} as never,
    getUserById: async () => ({
      _id: owner,
      openidIssuer: 'https://identity.test',
      openidId: 'managed',
      tenantId: 'tenant',
    }),
    dispatch: jest.fn(),
  });
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return { handler, repository, invalidate, audit, res };
}
it('journals a typed assignment and invalidates affected users after applying native ACL', async () => {
  const { handler, repository, res, audit, invalidate } = setup();
  await handler(
    {
      method: 'POST',
      path: '/assignments',
      headers: {},
      body: {
        kind: 'skills',
        owner_id: owner,
        resource_id: 'skill',
        policy_id: '00000000-0000-4000-8000-000000000004',
        member_ids: [user],
        active: true,
      },
    } as Request,
    res as unknown as Response,
    jest.fn(),
  );
  expect(beginGovernanceMutation).toHaveBeenCalled();
  expect(audit).toHaveBeenCalled();
  expect(repository.assign).toHaveBeenCalledWith(
    'skills',
    owner,
    'tenant',
    'skill',
    '00000000-0000-4000-8000-000000000004',
    [user],
    true,
  );
  expect(invalidate).toHaveBeenCalledWith('skills', 'skill', [], user);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
});
it.each(['/assignments', '/commands'])(
  'rejects mutations after native deletion has begun: %s',
  async (path) => {
    const { handler, repository, res } = setup();
    repository.get.mockResolvedValue({
      _id: '000000000000000000000003',
      governanceRevision: 3,
      deletingAt: new Date(),
    });
    await handler(
      {
        method: 'POST',
        path,
        headers: {},
        body: {
          kind: 'skills',
          owner_id: owner,
          resource_id: 'skill',
          action: 'update',
          data: {},
        },
      } as Request,
      res as unknown as Response,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ code: 'RESOURCE_DELETING' });
    expect(repository.assign).not.toHaveBeenCalled();
  },
);
it('rejects a stale individual state without claiming that it was applied', async () => {
  const { handler, repository, res, invalidate } = setup();
  repository.userState.mockResolvedValue(false);
  await handler(
    {
      method: 'POST',
      path: '/state',
      headers: {},
      body: {
        kind: 'skills',
        owner_id: owner,
        resource_id: 'skill',
        user_id: user,
        enabled: false,
        expected_revision: 2,
      },
    } as Request,
    res as unknown as Response,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ code: 'REVISION_CONFLICT' });
  expect(invalidate).not.toHaveBeenCalled();
});
it('replays a durable mutation without touching assignments again', async () => {
  const { handler, repository, res } = setup();
  jest.mocked(beginGovernanceMutation).mockResolvedValue(false);
  await handler(
    {
      method: 'POST',
      path: '/assignments',
      headers: {},
      body: { kind: 'skills', owner_id: owner },
    } as Request,
    res as unknown as Response,
    jest.fn(),
  );
  expect(repository.assign).not.toHaveBeenCalled();
});
it('returns a validation error for malformed assignment members instead of an ambiguous server error', async () => {
  const { handler, repository, res } = setup();
  await handler(
    {
      method: 'POST',
      path: '/assignments',
      headers: {},
      body: {
        kind: 'skills',
        owner_id: owner,
        resource_id: 'skill',
        policy_id: '00000000-0000-4000-8000-000000000004',
        member_ids: ['not-a-native-id'],
        active: true,
      },
    } as Request,
    res as unknown as Response,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(422);
  expect(res.json).toHaveBeenCalledWith({ code: 'INVALID_RESOURCE_INPUT' });
  expect(repository.assign).not.toHaveBeenCalled();
});
