import type { Request, Response } from 'express';
import type { GatewayDeps } from './config';
import { createManagedSelfService } from './selfService';

const subject = '00000000-0000-4000-8000-000000000041';
function setup() {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const config: GatewayDeps = {
    issuer: 'https://idp.test/realms/main',
    bridgeURL: 'https://router.test/api/bpbatam',
    clientId: 'self-service-unit',
    clientSecret: 'test-only',
    endpoint: 'managed',
    audience: 'test',
    publicAPIURL: 'https://api.test/v1',
    fetch: jest.fn(async (url, options) => {
      const path = String(url);
      if (path.endsWith('/token'))
        return new Response(JSON.stringify({ access_token: 'machine-only', expires_in: 60 }));
      calls.push({
        url: path,
        ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}),
      });
      let value: Record<string, unknown> = {
        key_id: '00000000-0000-4000-8000-000000000042',
        key: 'new-secret-only',
      };
      if (path.includes('/self-account'))
        value = { subject, issuer: config.issuer, wallet: { available: '100' } };
      else if (path.includes('/self-keys')) value = { keys: [] };
      return new Response(JSON.stringify(value));
    }) as unknown as GatewayDeps['fetch'],
  };
  const audit = jest.fn(async () => undefined);
  const handler = createManagedSelfService({ config: () => config, audit });
  const req = {
    user: { provider: 'openid', openidId: subject, openidIssuer: config.issuer },
    query: { subject: 'other-user' },
    body: {},
    params: {},
    get: (key: string) => ({ origin: 'https://chat.test', host: 'chat.test' })[key],
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  return { handler, req, res, calls, audit };
}
it('binds account reads to the authenticated subject and omits service identity data', async () => {
  const { handler, req, res, calls } = setup();
  await handler.account(req, res);
  expect(calls[0].url).toContain('subject=' + subject);
  const value = (res.json as jest.Mock).mock.calls[0][0];
  expect(value).toMatchObject({ api_base_url: 'https://api.test/v1', endpoint: 'managed' });
  expect(value.subject).toBeUndefined();
  expect(value.issuer).toBeUndefined();
  expect(JSON.stringify(value)).not.toContain('machine-only');
});
it('rejects caller-controlled ownership, missing identity and cross-origin writes before dispatch', async () => {
  const { handler, req, res, calls } = setup();
  req.body = { name: 'External', command_id: subject, subject: 'forged' };
  await handler.create(req, res);
  expect(res.status).toHaveBeenLastCalledWith(422);
  expect(calls).toHaveLength(0);
  req.body = { name: 'External', command_id: subject };
  req.get = (() => 'foreign.test') as unknown as Request['get'];
  await handler.create(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
  expect(calls).toHaveLength(0);
  req.user = undefined;
  await handler.account(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
});
it('creates keys under the session subject and audits metadata without key plaintext', async () => {
  const { handler, req, res, calls, audit } = setup();
  req.body = { name: 'External', command_id: subject };
  await handler.create(req, res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(calls[0].body).toEqual({
    op: 'self-key-create',
    subject,
    name: 'External',
    command_id: subject,
  });
  expect(JSON.stringify(audit.mock.calls)).not.toContain('new-secret-only');
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
it('reveals and renames only through owner-bound commands and rejects entitlement edits', async () => {
  const { handler, req, res, calls, audit } = setup();
  req.params.id = subject;
  await handler.reveal(req, res);
  expect(calls[0].body).toEqual({ op: 'self-key-reveal', subject, key_id: subject });
  req.body = { name: 'Renamed', offers: ['forged'] };
  await handler.rename(req, res);
  expect(res.status).toHaveBeenLastCalledWith(422);
  req.body = { name: 'Renamed' };
  await handler.rename(req, res);
  expect(calls[1].body).toEqual({
    op: 'self-key-rename',
    subject,
    key_id: subject,
    name: 'Renamed',
  });
  expect(JSON.stringify(audit.mock.calls)).not.toContain('new-secret-only');
});

it('submits a token request bound to the signed-in subject, never a supplied account', async () => {
  const { handler, req, res, calls, audit } = setup();
  req.body = { amount: 1000, reason: 'Need tokens for analysis', request_id: subject };
  await handler.requestTokens(req, res);
  expect(res.status).toHaveBeenLastCalledWith(201);
  expect(calls[0].body).toEqual({ op: 'self-topup-request', subject, ...req.body });
  expect(audit).toHaveBeenCalled();
});
it('rejects forged ownership, unsafe amounts, and cross-origin token requests', async () => {
  const { handler, req, res, calls } = setup();
  for (const body of [
    { amount: 100, reason: 'Valid reason for request', request_id: subject, subject: 'forged' },
    { amount: -1, reason: 'Valid reason for request', request_id: subject },
    { amount: 0.5, reason: 'Valid reason for request', request_id: subject },
  ]) {
    req.body = body;
    await handler.requestTokens(req, res);
    expect(res.status).toHaveBeenLastCalledWith(422);
  }
  req.body = { amount: 100, reason: 'Valid reason for request', request_id: subject };
  req.get = ((key: string) =>
    key === 'host' ? 'chat.test' : 'https://evil.test') as Request['get'];
  await handler.requestTokens(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
  expect(calls).toHaveLength(0);
});
it('lists token requests only for the immutable current subject', async () => {
  const { handler, req, calls } = setup();
  await handler.requests(req, setup().res);
  expect(calls[0].url).toContain('/self-topups?subject=' + subject);
});
