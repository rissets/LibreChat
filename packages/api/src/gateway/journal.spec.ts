import { beginGovernanceMutation, createGovernanceJournalHandler } from './journal';
import { governanceIdentity } from './delegation';
jest.mock('./delegation', () => ({ governanceIdentity: jest.fn() }));
import type { Request, Response } from 'express';
function response() {
  const r = {
    statusCode: 201,
    headersSent: false,
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
    getHeader: jest.fn(() => 'application/json'),
  };
  r.send.mockReturnValue(r);
  r.json.mockReturnValue(r);
  r.status.mockImplementation((code) => {
    r.statusCode = code;
    return r;
  });
  r.type.mockReturnValue(r);
  return r;
}
it('persists an encrypted native receipt before sending and replays without dispatch', async () => {
  let row: { state: string; encryptedResponse?: string; expiresAt?: string } = { state: 'started' };
  const complete = jest.fn(async (_id: string, _hash: string, value: string) => {
    row = {
      state: 'completed',
      encryptedResponse: value,
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    };
  });
  const deps = {
    store: { claim: jest.fn(async () => row), complete },
    encrypt: async (s: string) => Buffer.from(s).toString('base64'),
    decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
  };
  const req = {
    headers: { 'x-command-id': 'one-command' },
    method: 'POST',
    originalUrl: '/api/bpbatam/resources/commands',
    body: { kind: 'agent-api-keys' },
  } as unknown as Request;
  const first = response();
  const original = first.send;
  expect(await beginGovernanceMutation(req, first as unknown as Response, deps)).toBe(true);
  first.send('{"key":"one-time-secret"}');
  await new Promise((resolve) => setImmediate(resolve));
  expect(complete).toHaveBeenCalledTimes(1);
  expect(original).toHaveBeenCalledWith('{"key":"one-time-secret"}');
  expect(row.encryptedResponse).not.toContain('one-time-secret');
  const retry = response();
  expect(await beginGovernanceMutation(req, retry as unknown as Response, deps)).toBe(false);
  expect(retry.send).toHaveBeenCalledWith('{"key":"one-time-secret"}');
  row = { state: 'pending' };
  const interrupted = response();
  expect(await beginGovernanceMutation(req, interrupted as unknown as Response, deps)).toBe(false);
  expect(interrupted.json).toHaveBeenCalledWith({ code: 'NATIVE_COMMAND_RECONCILIATION_REQUIRED' });
});

it('exposes journal metadata without receipts and requires an independent approval before an attested closure', async () => {
  jest.mocked(governanceIdentity).mockResolvedValue({ sub: 'service', name: 'control' });
  const complete = jest.fn(async () => undefined);
  const audit = jest.fn(async () => undefined);
  const handler = createGovernanceJournalHandler({
    store: {
      claim: jest.fn(),
      complete,
      inspect: async () => ({
        state: 'pending',
        requestHash: 'hash',
        encryptedResponse: 'private-secret',
        expiresAt: new Date().toISOString(),
      }),
    },
    encrypt: async (s) => s,
    decrypt: async (s) => s,
    audit,
  });
  const id = '00000000-0000-4000-8000-000000000001:native-resource-operation';
  const req = { method: 'GET', path: '/' + id, headers: {} } as unknown as Request;
  const metadata = response();
  await handler(req, metadata as unknown as Response, jest.fn());
  expect(JSON.stringify(metadata.json.mock.calls)).not.toContain('private-secret');
  req.method = 'POST';
  Object.assign(req, {
    path: '/' + id + '/resolve',
    body: {
      resolution_id: '00000000-0000-4000-8000-000000000002',
      outcome: 'not_applied',
      evidence: 'Owner evidence confirms the synthetic action did not run.',
    },
  });
  req.headers = {
    'x-actor-id': 'maker',
    'x-checker-id': 'maker',
    'x-approval-id': '00000000-0000-4000-8000-000000000003',
    'x-approval-payload-hash': 'a'.repeat(64),
  };
  const denied = response();
  await handler(req, denied as unknown as Response, jest.fn());
  expect(denied.status).toHaveBeenCalledWith(422);
  expect(complete).not.toHaveBeenCalled();
  req.headers['x-checker-id'] = 'checker';
  const accepted = response();
  await handler(req, accepted as unknown as Response, jest.fn());
  expect(complete).toHaveBeenCalledTimes(1);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(accepted.json).toHaveBeenCalledWith({
    resolved: true,
    outcome: 'not_applied',
    execution_repeated: false,
  });
});

it('does not acknowledge a legacy HTTP200 storage error as a successful mutation', async () => {
  const complete = jest.fn();
  const deps = {
    store: { claim: async () => ({ state: 'started' }), complete },
    encrypt: async (s: string) => s,
    decrypt: async (s: string) => s,
  };
  const req = {
    headers: { 'x-command-id': 'legacy-error' },
    method: 'POST',
    originalUrl: '/api/bpbatam/resources/commands',
    body: {},
  } as unknown as Request;
  const res = response();
  expect(await beginGovernanceMutation(req, res as unknown as Response, deps)).toBe(true);
  res.send(JSON.stringify({ message: 'Error making prompt production' }));
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ code: 'NATIVE_OPERATION_FAILED' });
  expect(complete).not.toHaveBeenCalled();
});

it('accepts a direct admin approval attested by the authenticated governance service', async () => {
  const complete = jest.fn(async () => undefined);
  const audit = jest.fn(async () => undefined);
  const handler = createGovernanceJournalHandler({
    store: {
      claim: jest.fn(),
      complete,
      inspect: async () => ({
        state: 'pending',
        requestHash: 'hash',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    },
    encrypt: async (value) => value,
    decrypt: async (value) => value,
    audit,
  });
  const req = {
    method: 'POST',
    path: '/fixture-command/resolve',
    headers: {
      'x-actor-id': 'admin',
      'x-checker-id': 'admin',
      'x-approval-mode': 'admin-direct',
      'x-approval-id': '00000000-0000-4000-8000-000000000003',
      'x-approval-payload-hash': 'a'.repeat(64),
    },
    body: {
      resolution_id: '00000000-0000-4000-8000-000000000002',
      outcome: 'not_applied',
      evidence: 'Verified provider evidence for the isolated administrative action.',
    },
  } as unknown as Request;
  jest.mocked(governanceIdentity).mockResolvedValue(null);
  const unauthenticated = response();
  await handler(req, unauthenticated as unknown as Response, jest.fn());
  expect(unauthenticated.status).toHaveBeenCalledWith(403);
  expect(complete).not.toHaveBeenCalled();
  jest.mocked(governanceIdentity).mockResolvedValue({ sub: 'service', name: 'control' });
  const accepted = response();
  await handler(req, accepted as unknown as Response, jest.fn());
  expect(complete).toHaveBeenCalledTimes(1);
  expect(accepted.json).toHaveBeenCalledWith({
    resolved: true,
    outcome: 'not_applied',
    execution_repeated: false,
  });
});
