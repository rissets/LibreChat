import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import type { GatewayDeps } from './config';
import { createMeetingGateway } from './meetings';

const subject = '00000000-0000-4000-8000-000000000061';
const meeting = '00000000-0000-4000-8000-000000000062';
const chat = '00000000-0000-4000-8000-000000000063';
function setup() {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  let confirm = true;
  const config: GatewayDeps = {
    issuer: 'https://idp.test/realms/meeting-workspace',
    clientId: 'meeting-workspace-test',
    clientSecret: 'synthetic-only',
    audience: 'test',
    endpoint: 'managed',
    bridgeURL: 'https://router.test/api/bpbatam',
    meetingURL: 'https://cp.test/api/internal/meetings',
    tenantId: 'bp-batam',
    fetch: Object.assign(
      async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
        const path = String(url);
        if (path.endsWith('/token'))
          return globalThis.Response.json({ access_token: 'machine-test', expires_in: 60 });
        if (path.endsWith('/sessions'))
          return globalThis.Response.json([{ id: 'browser-session' }]);
        if (path.includes('/admin/realms/')) return globalThis.Response.json({ enabled: true });
        calls.push({
          url: path,
          body: options?.body ? JSON.parse(String(options.body)) : undefined,
          headers: new Headers(options?.headers),
        });
        if (path.endsWith('/delivery'))
          return new globalThis.Response(
            JSON.stringify(confirm ? {} : { code: 'MEETING_ACCESS_DENIED' }),
            { status: confirm ? 200 : 403 },
          );
        return new globalThis.Response(JSON.stringify({ fixture: 'authorized' }), {
          headers: { 'X-Meeting-Delivery': 'signed-test-receipt' },
        });
      },
      { preconnect: () => undefined },
    ),
  };
  const req = {
    user: {
      provider: 'openid',
      openidIssuer: config.issuer,
      openidId: subject,
      identitySessionId: 'browser-session',
    },
    params: { id: meeting, chatId: chat },
    query: {},
    body: {},
    protocol: 'https',
    get: (key: string) => ({ origin: 'https://chat.test', host: 'chat.test' })[key],
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
    destroyed: false,
    writableEnded: false,
  }) as unknown as Response;
  return {
    handlers: createMeetingGateway({ config: () => config }),
    req,
    res,
    calls,
    revoke: () => {
      confirm = false;
    },
  };
}
it('binds notes writes to the verified session and confirms delivery before returning content', async () => {
  const { handlers, req, res, calls } = setup();
  req.body = { expected_revision: 0, notes: 'Catatan singkat' };
  await handlers.saveWorkspace(req, res);
  expect(res.status).toHaveBeenLastCalledWith(200);
  expect(calls[0].url).toBe('https://cp.test/api/internal/meetings/' + meeting + '/workspace');
  expect(calls[0].body).toEqual({ expected_revision: 0, notes: 'Catatan singkat' });
  expect(calls[0].headers.get('X-Meeting-Subject')).toBe(subject);
  expect(calls[1].url).toMatch(/\/delivery$/);
});
it('rejects forged notes ownership and cross-origin chat sends before CP dispatch', async () => {
  const { handlers, req, res, calls } = setup();
  req.body = { expected_revision: 0, notes: 'Forged', owner: 'other' };
  await handlers.saveWorkspace(req, res);
  expect(res.status).toHaveBeenLastCalledWith(422);
  expect(calls).toHaveLength(0);
  req.body = { operation_id: subject, question: 'Question' };
  function foreignHeader(name: 'set-cookie'): string[] | undefined;
  function foreignHeader(name: string): string | undefined;
  function foreignHeader(name: string): string | string[] | undefined {
    return name === 'set-cookie' ? [] : 'foreign.test';
  }
  req.get = foreignHeader;
  await handlers.chatMessage(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
  expect(calls).toHaveLength(0);
});
it('routes chat history without a meeting parameter and withholds content after delivery revocation', async () => {
  const { handlers, req, res, calls, revoke } = setup();
  delete req.params.id;
  await handlers.chat(req, res);
  expect(calls[0].url).toBe('https://cp.test/api/internal/meetings/chats/' + chat);
  expect(res.json).toHaveBeenLastCalledWith({ fixture: 'authorized' });
  revoke();
  await handlers.chats(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
  expect(res.json).toHaveBeenLastCalledWith({ code: 'MEETING_ACCESS_DENIED' });
});
it('fetches native meeting context for a valid meeting id and confirms delivery before responding', async () => {
  const { handlers, req, res, calls, revoke } = setup();
  await handlers.nativeContext(req, res);
  expect(calls[0].url).toBe('https://cp.test/api/internal/meetings/' + meeting + '/native-context');
  expect(calls[1].url).toBe('https://cp.test/api/internal/meetings/delivery');
  expect(res.status).toHaveBeenLastCalledWith(200);
  revoke();
  await handlers.nativeContext(req, res);
  expect(res.status).toHaveBeenLastCalledWith(403);
  expect(res.json).toHaveBeenLastCalledWith({ code: 'MEETING_ACCESS_DENIED' });
});
