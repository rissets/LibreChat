import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';

export type BPUsageWindow = {
  used_tokens?: number;
  limit_tokens?: number;
  remaining_tokens?: number;
  next_reset_at?: string | null;
};

export type BPAccessSnapshot = {
  quota?: BPUsageWindow & {
    windows?: Record<'5h' | 'weekly' | 'monthly', BPUsageWindow>;
  };
  models?: Array<{ model: string; name: string; provider?: string }>;
  router_status?: string;
};

async function getBPAccessSnapshot(): Promise<BPAccessSnapshot> {
  // Use LibreChat's authenticated request client. A browser fetch only sent the
  // refresh cookie while this endpoint is protected by the bearer access token,
  // which caused the account usage card and managed-agent sync to fail with 401.
  return request.get<BPAccessSnapshot>(`${apiBaseUrl()}/api/bp-ai/access`);
}

export const useBPAccessSnapshot = (
  config?: UseQueryOptions<BPAccessSnapshot>,
): QueryObserverResult<BPAccessSnapshot> =>
  useQuery<BPAccessSnapshot>(['bp-ai-access'], getBPAccessSnapshot, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
    ...config,
  });
