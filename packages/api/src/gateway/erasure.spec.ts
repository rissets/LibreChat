import type { Request, Response } from 'express';
import { createGovernanceErasure, requiresSelfServiceErasure } from './erasure';
import { governanceIdentity } from './delegation';

jest.mock('./delegation', () => ({
  ...jest.requireActual('./delegation'),
  governanceIdentity: jest.fn(),
}));

const issuer = 'https://issuer.test/realms/bpbatam';
const userId = '000000000000000000000001';
const environment = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, {
    BPBATAM_GATEWAY_ENDPOINT: 'Rissets',
    OPENID_ISSUER: issuer,
    BPBATAM_BRIDGE_URL: 'http://router.test',
    BPBATAM_LC_CLIENT_ID: 'test-service',
    BPBATAM_LC_CLIENT_SECRET: 'synthetic-erasure-test-secret',
  });
});
afterAll(() => {
  process.env = environment;
});

function fixture(mode: string | undefined = 'admin-direct', checker = 'admin') {
  const req = {
    headers: {
      'x-actor-id': 'admin',
      'x-checker-id': checker,
      'x-approval-id': '00000000-0000-4000-8000-000000000001',
      'x-approval-payload-hash': 'a'.repeat(64),
      'x-command-id': 'approved-command:librechat-owner-erasure',
      ...(mode ? { 'x-approval-mode': mode } : {}),
    },
    body: { userId, subject: 'target-subject', issuer },
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  } as unknown as Response;
  const deps = {
    getUserById: jest.fn(async () => ({
      _id: userId,
      openidId: 'target-subject',
      openidIssuer: issuer,
    })),
    audit: jest.fn(async () => undefined),
    erase: jest.fn(async (request: Request, response: Response) => {
      expect(requiresSelfServiceErasure(request, true)).toBe(false);
      expect(request.body).toEqual({});
      response.json({ erased: true });
    }),
  };
  jest
    .mocked(governanceIdentity)
    .mockResolvedValue({ sub: 'trusted-service', name: 'control-plane' });
  return { req, res, deps, handler: createGovernanceErasure(deps) };
}

it('accepts an authenticated admin-direct approval when maker and checker are the same admin', async () => {
  const { req, res, deps, handler } = fixture();
  await handler(req, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(deps.erase).toHaveBeenCalledTimes(1);
  expect(deps.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ approvalMode: 'admin-direct' }),
    }),
    { failClosed: true },
  );
});

it('retains independent checker approval', async () => {
  const { req, res, deps, handler } = fixture('independent', 'checker');
  await handler(req, res);
  expect(deps.erase).toHaveBeenCalledTimes(1);
  expect(deps.audit).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: expect.objectContaining({ approvalMode: 'independent' }) }),
    { failClosed: true },
  );
});

it.each(['', 'independent', 'ADMIN-DIRECT', 'invalid'])(
  'rejects same-actor approval without the exact trusted mode: %s',
  async (mode) => {
    const { req, res, deps, handler } = fixture(mode);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 'APPROVED_ERASURE_REQUIRED' });
    expect(deps.getUserById).not.toHaveBeenCalled();
    expect(deps.erase).not.toHaveBeenCalled();
  },
);

it.each(['x-actor-id', 'x-checker-id', 'x-approval-id', 'x-approval-payload-hash'])(
  'requires approval evidence: %s',
  async (header) => {
    const { req, res, deps, handler } = fixture();
    delete req.headers[header];
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deps.erase).not.toHaveBeenCalled();
  },
);

it('does not trust admin-direct headers without authenticated governance identity', async () => {
  const { req, res, deps, handler } = fixture();
  jest.mocked(governanceIdentity).mockResolvedValue(null);
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(deps.erase).not.toHaveBeenCalled();
});

it('rejects a target subject mismatch before audit or deletion', async () => {
  const { req, res, deps, handler } = fixture();
  req.body.subject = 'another-subject';
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(deps.audit).not.toHaveBeenCalled();
  expect(deps.erase).not.toHaveBeenCalled();
});

it('does not delete when the audit cannot be persisted', async () => {
  const { req, res, deps, handler } = fixture();
  deps.audit.mockRejectedValueOnce(new Error('audit unavailable'));
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(deps.erase).not.toHaveBeenCalled();
});
