import jwt from 'jsonwebtoken';
import {
  resolveManagedCredential,
  managedSessionOptions,
  gatewayConfig,
  validateManagedJwtUser,
} from './index';

describe('managed gateway boundary', () => {
  beforeEach(() => {
    delete process.env.BPBATAM_GATEWAY_ENDPOINT;
  });
  afterEach(() => {
    delete process.env.BPBATAM_GATEWAY_ENDPOINT;
  });
  it('preserves disabled deployment behavior', () => {
    expect(gatewayConfig()).toBeNull();
    expect(managedSessionOptions(null, 123)).toEqual({ expiresIn: 123 });
  });
  it('uses a subject-bound server secret and rejects a forged model or subject', async () => {
    const user = {
      provider: 'openid',
      openidIssuer: 'https://idp.test/realms/test',
      openidId: '00000000-0000-4000-8000-000000000001',
    };
    let changed = false;
    let disabled = false;
    const config = {
      fetch: jest.fn(async (input: unknown) => {
        if (String(input).endsWith('/token'))
          return new Response(JSON.stringify({ access_token: 'server-only', expires_in: 60 }), {
            status: 200,
          });
        if (String(input).includes('/admin/realms/'))
          return new Response(JSON.stringify({ enabled: !disabled }), { status: 200 });
        return new Response(
          JSON.stringify({
            subject: changed
              ? '00000000-0000-4000-8000-000000000002'
              : '00000000-0000-4000-8000-000000000001',
            issuer: user.openidIssuer,
            key: 'inference-only',
            offers: [{ id: 'p0/allowed' }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
      issuer: user.openidIssuer,
      bridgeURL: 'https://gateway.test/api/bpbatam',
      clientId: 'lc-test',
      clientSecret: 'private-fixture',
      endpoint: 'P0Router',
      audience: 'gateway',
    };
    expect(await resolveManagedCredential(user, 'P0Router', 'p0/allowed', config)).toEqual({
      key: 'inference-only',
      models: ['p0/allowed'],
      baseURL: 'https://gateway.test/v1',
    });
    await expect(resolveManagedCredential(user, 'P0Router', 'p0/forged', config)).rejects.toThrow(
      'MODEL_NOT_ASSIGNED',
    );
    await expect(resolveManagedCredential(user, 'openAI', 'p0/allowed', config)).rejects.toThrow(
      'MANAGED_ENDPOINT_REQUIRED',
    );
    changed = true;
    await expect(resolveManagedCredential(user, 'P0Router', 'p0/allowed', config)).rejects.toThrow(
      'MANAGED_SUBJECT_MISMATCH',
    );
    changed = false;
    disabled = true;
    await expect(resolveManagedCredential(user, 'P0Router', 'p0/allowed', config)).rejects.toThrow(
      'PRINCIPAL_DISABLED',
    );
  });
  it('persists the exact validated IdP session sid for native refresh sessions', () => {
    process.env.BPBATAM_GATEWAY_ENDPOINT = 'P0Router';
    process.env.BPBATAM_BRIDGE_URL = 'http://localhost';
    process.env.BPBATAM_LC_CLIENT_ID = 'lc';
    process.env.BPBATAM_LC_CLIENT_SECRET = 'private-fixture';
    process.env.OPENID_ISSUER = 'https://idp.test/realms/test';
    expect(
      managedSessionOptions(
        { user: { tokenset: { id_token: jwt.sign({ sid: 'identity-session-a' }, 'fixture') } } },
        100,
      ),
    ).toEqual({ expiresIn: 100, identitySessionId: 'identity-session-a' });
    expect(() => managedSessionOptions(null, 100)).toThrow('IDENTITY_SESSION_REQUIRED');
  });
});

it('admits only a bounded signed trigger on the verified workload route and rechecks identity status', async () => {
  Object.assign(process.env, {
    BPBATAM_GATEWAY_ENDPOINT: 'Managed',
    BPBATAM_BRIDGE_URL: 'https://gateway.test/api/bpbatam',
    BPBATAM_LC_CLIENT_ID: 'workload-test',
    BPBATAM_LC_CLIENT_SECRET: 'fixture',
    OPENID_ISSUER: 'https://idp.test/realms/workload',
  });
  let enabled = true;
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockImplementation(
      async (url: unknown) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/token')
              ? { access_token: 'fixture', expires_in: 300 }
              : { enabled },
          ),
        ),
    );
  const user = {
    provider: 'openid',
    openidIssuer: process.env.OPENID_ISSUER,
    openidId: '00000000-0000-4000-8000-000000000003',
  };
  const iat = Math.floor(Date.now() / 1000);
  const payload = { scope: 'agent_trigger', iat, exp: iat + 60 };
  try {
    expect(await validateManagedJwtUser(user, payload, false)).toBeNull();
    expect(await validateManagedJwtUser(user, payload, true)).toBe(user);
    expect(await validateManagedJwtUser(user, { ...payload, exp: iat + 3600 }, true)).toBeNull();
    expect(
      await validateManagedJwtUser(user, { ...payload, scope: 'rag_workload' }, true),
    ).toBeNull();
    enabled = false;
    expect(await validateManagedJwtUser(user, payload, true)).toBeNull();
  } finally {
    fetchSpy.mockRestore();
    delete process.env.BPBATAM_GATEWAY_ENDPOINT;
  }
});
