import type { NextFunction, Request, Response } from 'express';
import type { GatewayDeps } from '../gateway/config';
import { gatewayConfig as defaultGatewayConfig } from '../gateway/config';
import { isVerifiedGovernanceRequest } from '../gateway/delegation';

export const ONBOARDING_REQUIRED_CODE = 'ONBOARDING_REQUIRED';
export const ONBOARDING_REQUIRED_MESSAGE =
  'Onboarding must be completed before accessing chat services';

interface OnboardingGateUser {
  id?: string;
  _id?: unknown;
  onboardingCompleted?: boolean;
  departmentId?: string | null;
  role?: string;
}

export interface OnboardingGateDependencies {
  gatewayConfig?: () => GatewayDeps | null;
}

export interface OnboardingGateOptions {
  envelope?: 'flat' | 'nested';
}

const SAFE_METHODS: Record<string, true> = {
  OPTIONS: true,
};

const EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/onboarding',
  '/api/bpbatam',
  '/api/config',
  '/api/banner',
  '/api/user/terms',
  '/oauth',
  '/sso',
  '/health',
  '/livez',
  '/readyz',
];
const EXEMPT_READ_PATHS: Record<string, true> = {
  '/api/user': true,
  '/api/user/settings': true,
};

function getRequestPath(req: Request): string {
  const pathname = `${req.baseUrl ?? ''}${req.path ?? ''}`.toLowerCase().replace(/\/+$/, '');
  return pathname || '/';
}

export function isOnboardingExempt(req: Request): boolean {
  if (SAFE_METHODS[req.method]) {
    return true;
  }
  if (isVerifiedGovernanceRequest(req)) {
    return true;
  }
  const pathname = getRequestPath(req);
  for (const prefix of EXEMPT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return true;
    }
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && EXEMPT_READ_PATHS[pathname]) {
    return true;
  }
  return false;
}

/**
 * Server-side gate that blocks chat and execution routes until onboarding is complete.
 * Active in managed gateway mode.
 */
export function createOnboardingGate(
  deps: OnboardingGateDependencies = {},
  options: OnboardingGateOptions = {},
) {
  const getGateway = deps.gatewayConfig ?? defaultGatewayConfig;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only enforced in managed gateway mode
    const gateway = getGateway();
    if (!gateway) {
      return next();
    }

    if (isOnboardingExempt(req)) {
      return next();
    }

    const user = req.user as OnboardingGateUser | undefined;
    if (!user) {
      // Unauthenticated request, let downstream auth handler return 401
      return next();
    }

    // Pass if onboarding is complete
    if (user.onboardingCompleted === true) {
      return next();
    }

    // Block request
    const responsePayload =
      options.envelope === 'nested'
        ? {
            error: {
              type: 'invalid_request_error',
              code: ONBOARDING_REQUIRED_CODE,
              message: ONBOARDING_REQUIRED_MESSAGE,
              param: null,
            },
          }
        : {
            code: ONBOARDING_REQUIRED_CODE,
            message: ONBOARDING_REQUIRED_MESSAGE,
          };

    res.status(403).json(responsePayload);
  };
}
