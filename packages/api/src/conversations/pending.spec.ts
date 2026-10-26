import express from 'express';
import request from 'supertest';
import { createPendingConversationRead } from './pending';

const id = '12ea1f20-120e-4111-8ef0-a09d8b511125';
function setup(view: 'subagents' | 'queued-turns' | 'title' = 'subagents') {
  const deps = {
    getJob: jest
      .fn()
      .mockResolvedValue({ status: 'running', metadata: { userId: 'owner', tenantId: 'a' } }),
    getConvoOwnership: jest.fn().mockResolvedValue(null),
  };
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { user: { id: 'owner', tenantId: 'a' } });
    next();
  });
  app.get('/:conversationId', createPendingConversationRead(deps, view), (_req, res) => {
    res.status(404).end();
  });
  return { deps, app };
}

it.each(['subagents', 'queued-turns', 'title'] as const)(
  'serves an empty %s view only for an owned provisional stream',
  async (view) => {
    const { app } = setup(view);
    const response = await request(app).get('/' + id + '?conversationId=' + id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      view === 'subagents'
        ? { parentConversationId: id, children: [], childrenTruncated: false }
        : view === 'title'
          ? { title: 'New Chat' }
          : {
              queuedTurns: [],
              capability: { supported: true, durability: 'durable', protocolVersion: 2 },
              revision: 0,
            },
    );
  },
);

it.each([
  null,
  { status: 'running', metadata: { userId: 'another', tenantId: 'a' } },
  { status: 'running', metadata: { userId: 'owner', tenantId: 'b' } },
  { status: 'completed', metadata: { userId: 'owner', tenantId: 'a' } },
])('does not grant access from an absent, foreign, or finished stream', async (job) => {
  const { app, deps } = setup();
  deps.getJob.mockResolvedValue(job);
  expect((await request(app).get('/' + id)).status).toBe(404);
  expect(deps.getConvoOwnership).not.toHaveBeenCalled();
});

it('lets the native handler return real data for an existing conversation', async () => {
  const { app, deps } = setup();
  deps.getConvoOwnership.mockResolvedValue({});
  expect((await request(app).get('/' + id)).status).toBe(404);
});
