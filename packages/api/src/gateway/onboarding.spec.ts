import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import {
  createLocalAssertionToken,
  resolveUserIdentityToken,
  resolveControlPanelBaseUrl,
  createOnboardingGateway,
  OnboardingServiceError,
} from './onboarding';
import type { GatewayDeps } from './config';

describe('onboarding gateway service', () => {
  const secret = 'test-assertion-secret-with-high-entropy-12345';

  describe('createLocalAssertionToken', () => {
    it('creates a valid HS256 assertion token with expected claims', () => {
      const token = createLocalAssertionToken(
        {
          id: 'user-mongo-123',
          email: 'localuser@bpbatam.go.id',
          name: 'Local User',
        },
        secret,
      );

      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
      expect(decoded.iss).toBe('bpchat-local');
      expect(decoded.aud).toBe('control-panel');
      expect(decoded.sub).toBe('user-mongo-123');
      expect(decoded.email).toBe('localuser@bpbatam.go.id');
      expect(decoded.name).toBe('Local User');
      expect(typeof decoded.exp).toBe('number');
      expect(typeof decoded.iat).toBe('number');
      expect(decoded.exp! as number - (decoded.iat! as number)).toBe(300);
    });
    it('binds openid_sub and openid_iss when user is linked', () => {
      const token = createLocalAssertionToken(
        {
          id: 'user-mongo-123',
          email: 'localuser@bpbatam.go.id',
          name: 'Local User',
          openidId: 'bpass-sub-456',
          openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
        },
        secret,
      );

      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<
        string,
        unknown
      >;
      expect(decoded.openid_sub).toBe('bpass-sub-456');
      expect(decoded.openid_iss).toBe('https://sso-dev.bpbatam.go.id/application/o/devai/');
    });

    it('creates assertion token with username for username-only user', () => {
      const token = createLocalAssertionToken(
        {
          id: 'user-mongo-456',
          username: 'pegawai_local',
          name: 'Pegawai Local',
        },
        secret,
      );

      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<
        string,
        unknown
      >;
      expect(decoded.sub).toBe('user-mongo-456');
      expect(decoded.username).toBe('pegawai_local');
      expect(decoded.preferred_username).toBe('pegawai_local');
      expect(decoded.email).toBeUndefined();
    });

    it('throws when user has no id', () => {
      expect(() =>
        createLocalAssertionToken({ email: 'user@test.com' }, secret),
      ).toThrow(OnboardingServiceError);
    });
  });

  describe('resolveUserIdentityToken', () => {
    const validOidcToken = jwt.sign(
      { sub: 'sub-abc-123', iss: 'https://idp.test/realms/bp' },
      'synthetic-oidc-secret',
    );

    it('ignores client header X-User-Identity-Token and reads server-stored token only', () => {
      const req = {
        headers: { 'x-user-identity-token': 'spoofed-caller-token' },
        cookies: { openid_id_token: validOidcToken },
      } as unknown as Request;

      const token = resolveUserIdentityToken(req, {
        provider: 'openid',
        openidId: 'sub-abc-123',
        openidIssuer: 'https://idp.test/realms/bp',
        id: 'u1',
      });
      expect(token).toBe(validOidcToken);
      expect(token).not.toBe('spoofed-caller-token');
    });

    it('rejects OIDC token when sub does not match bound openidId', () => {
      const req = {
        headers: {},
        cookies: { openid_id_token: validOidcToken },
      } as unknown as Request;

      expect(() =>
        resolveUserIdentityToken(req, {
          provider: 'openid',
          openidId: 'different-subject',
          openidIssuer: 'https://idp.test/realms/bp',
          id: 'u1',
        }),
      ).toThrow(expect.objectContaining({ code: 'OIDC_SUBJECT_MISMATCH' }));
    });

    it('rejects OIDC token when iss does not match bound openidIssuer', () => {
      const req = {
        headers: {},
        cookies: { openid_id_token: validOidcToken },
      } as unknown as Request;

      expect(() =>
        resolveUserIdentityToken(req, {
          provider: 'openid',
          openidId: 'sub-abc-123',
          openidIssuer: 'https://attacker-idp.test',
          id: 'u1',
        }),
      ).toThrow(expect.objectContaining({ code: 'OIDC_ISSUER_MISMATCH' }));
    });

    it('creates local assertion token for local user using dedicated secret', () => {
      const req = {
        headers: {},
        cookies: {},
      } as unknown as Request;

      const token = resolveUserIdentityToken(
        req,
        {
          provider: 'local',
          id: 'local-123',
          email: 'user@test.com',
          name: 'User',
        },
        secret,
      );

      const decoded = jwt.verify(token, secret) as Record<string, unknown>;
      expect(decoded.sub).toBe('local-123');
      expect(decoded.iss).toBe('bpchat-local');
    });

    it('does NOT fallback to JWT_SECRET when BPBATAM_LOCAL_ASSERTION_SECRET is unset', () => {
      const originalAssertionSecret = process.env.BPBATAM_LOCAL_ASSERTION_SECRET;
      const originalJwtSecret = process.env.JWT_SECRET;
      delete process.env.BPBATAM_LOCAL_ASSERTION_SECRET;
      process.env.JWT_SECRET = 'some-jwt-secret';

      const req = { headers: {}, cookies: {} } as unknown as Request;
      expect(() =>
        resolveUserIdentityToken(req, {
          provider: 'local',
          id: 'local-123',
          email: 'user@test.com',
        }),
      ).toThrow(expect.objectContaining({ code: 'LOCAL_ASSERTION_SECRET_REQUIRED' }));

      process.env.BPBATAM_LOCAL_ASSERTION_SECRET = originalAssertionSecret;
      process.env.JWT_SECRET = originalJwtSecret;
    });

    it('rejects unsupported identity providers', () => {
      const req = { headers: {}, cookies: {} } as unknown as Request;
      expect(() =>
        resolveUserIdentityToken(req, {
          provider: 'github',
          id: 'gh-123',
        }),
      ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PROVIDER' }));
    });
  });

  describe('resolveControlPanelBaseUrl', () => {
    const originalEnv = process.env.BPBATAM_CONTROL_PANEL_URL;

    afterEach(() => {
      process.env.BPBATAM_CONTROL_PANEL_URL = originalEnv;
    });

    it('prioritizes BPBATAM_CONTROL_PANEL_URL when set', () => {
      process.env.BPBATAM_CONTROL_PANEL_URL = 'http://cp.test:9000/';
      const url = resolveControlPanelBaseUrl({} as GatewayDeps);
      expect(url).toBe('http://cp.test:9000');
    });

    it('derives from meetingURL when BPBATAM_CONTROL_PANEL_URL is not set', () => {
      delete process.env.BPBATAM_CONTROL_PANEL_URL;
      const url = resolveControlPanelBaseUrl({
        meetingURL: 'http://bpbatam-control-api:8088/api/internal/meetings',
      } as GatewayDeps);
      expect(url).toBe('http://bpbatam-control-api:8088');
    });
  });

  describe('createOnboardingGateway operations', () => {
    it('returns default completed profile when unmanaged (config is null)', async () => {
      const gateway = createOnboardingGateway({ config: () => null });
      const req = {
        user: { id: 'u1', email: 'u1@test.com', name: 'User One', departmentId: 'd1' },
      } as unknown as Request;

      const profile = await gateway.getProfile(req);
      expect(profile.onboarding_completed).toBe(true);
      expect(profile.department_id).toBe('d1');
    });

    it('calls Control Panel GET /api/v1/onboarding/profile in managed mode', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          principal_id: 'p1',
          subject: 's1',
          issuer: 'iss',
          email: 'u@test.com',
          name: 'U',
          onboarding_completed: false,
          department_locked: false,
          department_id: null,
          department_name: null,
          departments: [{ id: 'dept-it', name: 'IT', parent_id: null }],
          review_status: null,
        }),
      });

      const mockDeps: GatewayDeps = {
        fetch: mockFetch as unknown as typeof fetch,
        issuer: 'https://idp.test',
        bridgeURL: 'http://router.test',
        clientId: 'lc',
        clientSecret: 'secret',
        endpoint: 'test',
        audience: 'aud',
        meetingURL: 'http://control-panel:8088/api/internal/meetings',
      };

      // Mock machine token fetch
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('/token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'machine-jwt', expires_in: 3600 }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            principal_id: 'p1',
            subject: 's1',
            issuer: 'iss',
            email: 'u@test.com',
            name: 'U',
            onboarding_completed: false,
            department_locked: false,
            department_id: null,
            department_name: null,
            departments: [{ id: 'dept-it', name: 'IT', parent_id: null }],
            review_status: null,
          }),
        };
      });

      const gateway = createOnboardingGateway({
        config: () => mockDeps,
        assertionSecret: secret,
      });

      const req = {
        headers: {},
        cookies: {},
        user: {
          id: 'u-1',
          email: 'u@test.com',
          name: 'User',
          provider: 'local',
        },
      } as unknown as Request;

      const profile = await gateway.getProfile(req);
      expect(profile.departments).toHaveLength(1);
      expect(profile.departments[0].id).toBe('dept-it');
    });

    it('rejects complete() with invalid department payload (422)', async () => {
      const gateway = createOnboardingGateway({ config: () => null });
      const req = { user: { id: 'u1' } } as unknown as Request;

      await expect(gateway.complete(req, { department_id: '' })).rejects.toThrow(
        OnboardingServiceError,
      );
    });

    it('returns unmanaged profile fallback with real username and email fields', async () => {
      const gateway = createOnboardingGateway({ config: () => null });
      const req = {
        user: {
          id: 'u-user-1',
          username: 'pegawai123',
          email: 'pegawai@bpbatam.go.id',
          emailVerified: false,
          name: 'Pegawai',
        },
      } as unknown as Request;

      const profile = await gateway.getProfile(req);
      expect(profile.username).toBe('pegawai123');
      expect(profile.email).toBe('pegawai@bpbatam.go.id');
      expect(profile.email_verified).toBe(false);
      expect(profile.onboarding_completed).toBe(true);
    });
  });
});
