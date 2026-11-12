import type { Request, Response, NextFunction } from 'express';
import {
  createOnboardingGate,
  isOnboardingExempt,
  ONBOARDING_REQUIRED_CODE,
  ONBOARDING_REQUIRED_MESSAGE,
} from './onboarding';
import type { GatewayDeps } from '../gateway/config';

describe('onboarding gate middleware', () => {
  const createMockReq = (method: string, path: string, user?: Record<string, unknown>): Request =>
    ({
      method,
      baseUrl: '',
      path,
      user,
    }) as unknown as Request;

  const createMockRes = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res as unknown as Response;
  };

  const mockGatewayDeps: GatewayDeps = {
    fetch: jest.fn() as unknown as typeof fetch,
    issuer: 'https://idp.test',
    bridgeURL: 'http://router.test',
    clientId: 'lc',
    clientSecret: 'secret',
    endpoint: 'managed',
    audience: 'aud',
  };

  describe('isOnboardingExempt', () => {
    it('exempts OPTIONS requests', () => {
      expect(isOnboardingExempt(createMockReq('OPTIONS', '/api/convos'))).toBe(true);
    });

    it('exempts /api/auth and /api/onboarding routes', () => {
      expect(isOnboardingExempt(createMockReq('POST', '/api/auth/login'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('GET', '/api/onboarding/profile'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('POST', '/api/onboarding/complete'))).toBe(true);
    });
    it('exempts /api/bpbatam, /oauth, and /sso bridge/auth routes', () => {
      expect(isOnboardingExempt(createMockReq('POST', '/api/bpbatam/users'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('GET', '/api/bpbatam/native/config'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('GET', '/oauth/openid'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('GET', '/sso/callback'))).toBe(true);
    });


    it('exempts GET /api/user for reading profile but not mutations', () => {
      expect(isOnboardingExempt(createMockReq('GET', '/api/user'))).toBe(true);
      expect(isOnboardingExempt(createMockReq('POST', '/api/user/delete'))).toBe(false);
    });

    it('does NOT exempt chat and model execution routes', () => {
      expect(isOnboardingExempt(createMockReq('GET', '/api/convos'))).toBe(false);
      expect(isOnboardingExempt(createMockReq('POST', '/api/messages'))).toBe(false);
      expect(isOnboardingExempt(createMockReq('GET', '/api/agents'))).toBe(false);
      expect(isOnboardingExempt(createMockReq('POST', '/api/agents/chat'))).toBe(false);
      expect(isOnboardingExempt(createMockReq('GET', '/api/models'))).toBe(false);
    });
  });

  describe('createOnboardingGate', () => {
    it('passes through when unmanaged (gatewayConfig returns null)', async () => {
      const gate = createOnboardingGate({ gatewayConfig: () => null });
      const req = createMockReq('POST', '/api/messages', { id: 'u1', onboardingCompleted: false });
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      await gate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes through when route is exempt', async () => {
      const gate = createOnboardingGate({ gatewayConfig: () => mockGatewayDeps });
      const req = createMockReq('GET', '/api/onboarding/profile', {
        id: 'u1',
        onboardingCompleted: false,
      });
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      await gate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes through when user has completed onboarding', async () => {
      const gate = createOnboardingGate({ gatewayConfig: () => mockGatewayDeps });
      const req = createMockReq('POST', '/api/convos', {
        id: 'u1',
        onboardingCompleted: true,
        departmentId: 'dept-it',
      });
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      await gate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks chat routes with 403 ONBOARDING_REQUIRED when onboarding is incomplete', async () => {
      const gate = createOnboardingGate({ gatewayConfig: () => mockGatewayDeps });
      const req = createMockReq('POST', '/api/convos', {
        id: 'u1',
        onboardingCompleted: false,
      });
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      await gate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        code: ONBOARDING_REQUIRED_CODE,
        message: ONBOARDING_REQUIRED_MESSAGE,
      });
    });

    it('blocks direct API calls attempting to bypass onboarding with nested envelope when configured', async () => {
      const gate = createOnboardingGate(
        { gatewayConfig: () => mockGatewayDeps },
        { envelope: 'nested' },
      );
      const req = createMockReq('POST', '/api/agents/chat', {
        id: 'u1',
        onboardingCompleted: false,
      });
      const res = createMockRes();
      const next: NextFunction = jest.fn();

      await gate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          type: 'invalid_request_error',
          code: ONBOARDING_REQUIRED_CODE,
          message: ONBOARDING_REQUIRED_MESSAGE,
          param: null,
        },
      });
    });
  });
});
