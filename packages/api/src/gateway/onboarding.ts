import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Request } from 'express';
import type { GatewayDeps } from './config';
import { machineToken } from './index';

export interface OnboardingUser {
  id?: string;
  _id?: { toString(): string };
  name?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  provider?: string;
  openidId?: string;
  openidIssuer?: string;
  identitySessionId?: string;
  tokenset?: { id_token?: string; access_token?: string };
  federatedTokens?: { id_token?: string; access_token?: string };
  onboardingCompleted?: boolean;
  departmentId?: string | null;
  departmentName?: string | null;
}

export interface OnboardingDepartment {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface OnboardingProfileResponse {
  principal_id: string;
  subject: string;
  issuer: string;
  username: string | null;
  email: string | null;
  email_verified: boolean;
  name: string;
  onboarding_completed: boolean;
  department_locked: boolean;
  department_id: string | null;
  department_name: string | null;
  departments: OnboardingDepartment[];
  review_status: 'pending' | 'reviewed' | null;
}

export interface CompleteOnboardingResponse {
  status: string;
  principal_id: string;
  department_id: string;
  department_name: string;
  onboarding_completed: boolean;
  review_status: 'pending' | 'reviewed' | null;
}

export class OnboardingServiceError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
  ) {
    super(code);
  }
}

/** Creates a signed short-lived HMAC-SHA256 assertion token for local accounts */
export function createLocalAssertionToken(user: OnboardingUser, secret: string): string {
  const userId = (user.id || user._id?.toString() || '').trim();
  if (!userId) {
    throw new OnboardingServiceError('USER_ID_REQUIRED', 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: 'bpchat-local',
    aud: 'control-panel',
    sub: userId,
    name: user.name || '',
    iat: now,
    exp: now + 300,
  };
  if (user.username) {
    payload.username = user.username;
    payload.preferred_username = user.username;
  }
  if (user.email) {
    payload.email = user.email;
  }
  if (user.openidId) {
    payload.openid_sub = user.openidId;
  }
  if (user.openidIssuer) {
    payload.openid_iss = user.openidIssuer;
  }
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

/** Resolves verified user identity token for transport to Control Panel */
export function resolveUserIdentityToken(
  req: Request,
  user: OnboardingUser,
  assertionSecret?: string,
): string {
  if (user.provider !== 'openid' && user.provider !== 'local') {
    throw new OnboardingServiceError('UNSUPPORTED_PROVIDER', 400);
  }

  if (user.provider === 'openid') {
    // Server-stored token only; never accept caller-provided identity tokens
    const cookies = req.cookies || {};
    const oidcToken =
      req.session?.openidTokens?.idToken ||
      user.tokenset?.id_token ||
      user.federatedTokens?.id_token ||
      cookies.openid_id_token ||
      user.tokenset?.access_token ||
      user.federatedTokens?.access_token ||
      cookies.openid_access_token;

    if (!oidcToken) {
      throw new OnboardingServiceError('OIDC_TOKEN_REQUIRED', 401);
    }

    // Verify subject and issuer match user's bound openid identity before forwarding
    const decoded = jwt.decode(oidcToken) as { sub?: string; iss?: string } | null;
    if (!decoded || typeof decoded !== 'object') {
      throw new OnboardingServiceError('MALFORMED_OIDC_TOKEN', 401);
    }

    if (!user.openidId || decoded.sub !== user.openidId) {
      throw new OnboardingServiceError('OIDC_SUBJECT_MISMATCH', 403);
    }

    if (user.openidIssuer && decoded.iss) {
      const expectedIss = user.openidIssuer.replace(/\/+$/, '');
      const actualIss = decoded.iss.replace(/\/+$/, '');
      if (expectedIss !== actualIss) {
        throw new OnboardingServiceError('OIDC_ISSUER_MISMATCH', 403);
      }
    }

    return oidcToken;
  }

  // Local account assertion: dedicated secret only (no fallback to JWT_SECRET)
  const secret = assertionSecret || process.env.BPBATAM_LOCAL_ASSERTION_SECRET;
  if (!secret) {
    throw new OnboardingServiceError('LOCAL_ASSERTION_SECRET_REQUIRED', 503);
  }
  return createLocalAssertionToken(user, secret);
}

export function resolveControlPanelBaseUrl(c: GatewayDeps): string {
  if (process.env.BPBATAM_CONTROL_PANEL_URL) {
    return process.env.BPBATAM_CONTROL_PANEL_URL.replace(/\/+$/, '');
  }
  if (c.meetingURL) {
    try {
      return new URL(c.meetingURL).origin;
    } catch {
      /* ignore */
    }
  }
  return 'http://bpbatam-control-api:8088';
}

const completeOnboardingBodySchema = z
  .object({
    department_id: z.string().trim().min(1, 'department_id is required'),
    name: z.string().trim().min(1).optional(),
  })
  .strict();

export function createOnboardingGateway(deps: {
  config: () => GatewayDeps | null;
  assertionSecret?: string;
}) {
  return {
    async getProfile(req: Request): Promise<OnboardingProfileResponse> {
      const c = deps.config();
      const user = req.user as OnboardingUser | undefined;
      if (!user) {
        throw new OnboardingServiceError('AUTH_REQUIRED', 401);
      }

      // If gateway is not configured (unmanaged mode), return completed default
      if (!c) {
        return {
          principal_id: user.id || user._id?.toString() || '',
          subject: user.openidId || user.id || user._id?.toString() || '',
          issuer: user.openidIssuer || 'local',
          username: user.username || null,
          email: user.email || null,
          email_verified: Boolean(user.emailVerified),
          name: user.name || '',
          onboarding_completed: true,
          department_locked: false,
          department_id: user.departmentId || null,
          department_name: user.departmentName || null,
          departments: [],
          review_status: null,
        };
      }

      const userIdentityToken = resolveUserIdentityToken(req, user, deps.assertionSecret);
      const mToken = await machineToken(c);
      const baseUrl = resolveControlPanelBaseUrl(c);
      const url = `${baseUrl}/api/v1/onboarding/profile`;

      const rawId = (user.id || user._id?.toString() || '').trim();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${mToken}`,
        'X-User-Identity-Token': userIdentityToken,
        'Content-Type': 'application/json',
      };
      if (rawId && user.openidId) {
        headers['X-Linked-User-Id'] = rawId;
        const assertionSecret = deps.assertionSecret || process.env.BPBATAM_LOCAL_ASSERTION_SECRET;
        if (assertionSecret) {
          headers['X-Linked-Assertion'] = createLocalAssertionToken(user, assertionSecret);
        }
      }

      const response = await c.fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: { code?: string; message?: string };
          message?: string;
        };
        const candidate = errorBody.code ?? errorBody.error?.code ?? errorBody.message;
        throw new OnboardingServiceError(
          candidate && /^[A-Z_]+$/.test(candidate) ? candidate : 'ONBOARDING_GATEWAY_ERROR',
          [401, 403, 404, 409, 422].includes(response.status) ? response.status : 503,
        );
      }

      return (await response.json()) as OnboardingProfileResponse;
    },

    async complete(
      req: Request,
      body: unknown,
    ): Promise<CompleteOnboardingResponse> {
      const c = deps.config();
      const user = req.user as OnboardingUser | undefined;
      if (!user) {
        throw new OnboardingServiceError('AUTH_REQUIRED', 401);
      }

      const parseResult = completeOnboardingBodySchema.safeParse(body);
      if (!parseResult.success) {
        throw new OnboardingServiceError('INVALID_DEPARTMENT', 422);
      }
      const { department_id, name } = parseResult.data;

      if (!c) {
        return {
          status: 'completed',
          principal_id: user.id || user._id?.toString() || '',
          department_id,
          department_name: department_id,
          onboarding_completed: true,
          review_status: null,
        };
      }

      const userIdentityToken = resolveUserIdentityToken(req, user, deps.assertionSecret);
      const mToken = await machineToken(c);
      const baseUrl = resolveControlPanelBaseUrl(c);
      const url = `${baseUrl}/api/v1/onboarding/complete`;

      const rawId = (user.id || user._id?.toString() || '').trim();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${mToken}`,
        'X-User-Identity-Token': userIdentityToken,
        'Content-Type': 'application/json',
      };
      if (rawId && user.openidId) {
        headers['X-Linked-User-Id'] = rawId;
        const assertionSecret = deps.assertionSecret || process.env.BPBATAM_LOCAL_ASSERTION_SECRET;
        if (assertionSecret) {
          headers['X-Linked-Assertion'] = createLocalAssertionToken(user, assertionSecret);
        }
      }

      const response = await c.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ department_id, ...(name ? { name } : {}) }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: { code?: string; message?: string };
          message?: string;
        };
        const candidate = errorBody.code ?? errorBody.error?.code ?? errorBody.message;
        throw new OnboardingServiceError(
          candidate && /^[A-Z_]+$/.test(candidate) ? candidate : 'ONBOARDING_SUBMIT_FAILED',
          [401, 403, 404, 409, 422].includes(response.status) ? response.status : 503,
        );
      }

      return (await response.json()) as CompleteOnboardingResponse;
    },
  };
}
