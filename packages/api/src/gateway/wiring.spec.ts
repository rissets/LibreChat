import type { Request, Response } from 'express';
import {
  createGovernanceDispatcher,
  localIdentityDiscoveryOptions,
  createGovernanceResourceInvalidator,
} from './wiring';
import { managedSpeechSchema, managedImageConfiguration } from './index';
import { createResolveAgentFireAccess } from '../schedules/access';
import { withGovernanceAuthentication } from './delegation';

describe('native integration adapters', () => {
  it('requires an explicit switch and exact local host for HTTP identity discovery', () => {
    const allow = () => undefined;
    expect(
      localIdentityDiscoveryOptions('http://bpbatam-idp.localhost:8180', 'true', allow),
    ).toEqual({ execute: [allow] });
    expect(localIdentityDiscoveryOptions('http://idp.example', 'true', allow)).toEqual({});
    expect(localIdentityDiscoveryOptions('http://localhost', undefined, allow)).toEqual({});
    expect(localIdentityDiscoveryOptions('https://localhost', 'true', allow)).toEqual({});
  });
  it('does not trust a request-supplied governance marker', () => {
    const authenticate = jest.fn();
    const next = jest.fn();
    withGovernanceAuthentication(authenticate)(
      { governance: true } as unknown as Request,
      {} as Response,
      next,
    );
    expect(authenticate).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it('preserves legacy media configuration outside a managed deployment', async () => {
    const prior = process.env.BPBATAM_GATEWAY_ENDPOINT;
    delete process.env.BPBATAM_GATEWAY_ENDPOINT;
    try {
      const legacy = { openai: { apiKey: 'fixture' } };
      expect(await managedSpeechSchema(legacy, undefined, 'tts')).toBe(legacy);
      expect(
        await managedImageConfiguration(undefined, 'legacy-model', 'https://legacy.test', {
          apiKey: 'fixture',
        }),
      ).toEqual({
        selectedModel: 'legacy-model',
        destination: 'https://legacy.test',
        apiKey: 'fixture',
        clientConfig: { apiKey: 'fixture' },
      });
    } finally {
      if (prior) process.env.BPBATAM_GATEWAY_ENDPOINT = prior;
    }
  });
});

it('dispatches the native agent router from its exported module without losing errors', () => {
  const router = jest.fn();
  const next = jest.fn();
  const dispatch = createGovernanceDispatcher({
    configure: (_req, _res, next) => next(),
    load: () => ({ v1: router }),
    loadUpload: async () => router,
  });
  const req = {} as Request;
  const res = {} as Response;
  dispatch('agents/v1', req, res, next);
  expect(router).toHaveBeenCalledWith(req, res, next);
});

it('honors an explicit AGENTS revoke before schedule admission even when the resource ACL allows it', async () => {
  const findAgentObjectId = jest.fn();
  const check = createResolveAgentFireAccess({
    findAgentObjectId,
    getRoleByName: jest.fn(),
    hasCapability: jest.fn(),
    checkPermission: jest.fn(),
  });
  expect(
    await check('agent-1', { id: 'user-1', governancePermissions: { AGENTS: { USE: false } } }),
  ).toBe('forbidden');
  expect(findAgentObjectId).not.toHaveBeenCalled();
});

it('fences owned MCP registry and tool caches before acknowledging quarantine', async () => {
  const order: string[] = [];
  const invalidate = createGovernanceResourceInvalidator({
    config: async () => {
      order.push('config');
    },
    linkedCache: { delete: jest.fn() } as unknown as Parameters<
      typeof createGovernanceResourceInvalidator
    >[0]['linkedCache'],
    mcp: {
      registry: () => ({
        invalidateGovernedServer: async () => {
          order.push('registry');
        },
      }),
      fence: async () => {
        order.push('fence');
      },
      manager: () => ({
        disconnectUserConnection: async () => {
          order.push('disconnect');
        },
      }),
    },
  });
  await invalidate('mcp-servers', 'owned-server', [], 'owner');
  expect(order).toEqual(['registry', 'fence', 'disconnect', 'config']);
});
