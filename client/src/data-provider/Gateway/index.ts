import { QueryKeys, MutationKeys, request } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  GatewayAccount,
  GatewayKey,
  GatewayTokenRequest,
  GatewayTokenRequestInput,
} from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
export { remainingPercentage } from './limits';

export function useGatewayAccount(poll = false) {
  const { user } = useAuthContext();
  return useQuery<GatewayAccount>(
    ['gateway-account', user?.id],
    () => request.get('/api/gateway/account'),
    {
      enabled: user?.provider === 'openid',
      retry: false,
      staleTime: 15000,
      refetchInterval: poll ? 15000 : false,
    },
  );
}
export function useGatewayKeys() {
  const { user } = useAuthContext();
  return useQuery<{ keys: GatewayKey[] }>(
    ['gateway-keys', user?.id],
    () => request.get('/api/gateway/keys'),
    { retry: false },
  );
}
export function useCreateGatewayKey(onCreated: (key: { key_id: string; key: string }) => void) {
  const cache = useQueryClient();
  return useMutation(
    async (body: { name: string; command_id: string }) => {
      const created = (await request.post('/api/gateway/keys', body)) as {
        key_id: string;
        key: string;
      };
      // Keep plaintext out of the query/mutation cache. Only the current reveal view receives it.
      onCreated(created);
      return { key_id: created.key_id };
    },
    { onSuccess: () => cache.invalidateQueries(['gateway-keys']) },
  );
}
export function useDeleteGatewayKey() {
  const cache = useQueryClient();
  return useMutation(
    (id: string) => request.delete('/api/gateway/keys/' + encodeURIComponent(id)),
    {
      onSuccess: () => cache.invalidateQueries(['gateway-keys']),
    },
  );
}
export function useRevealGatewayKey(onRevealed: (key: { key_id: string; key: string }) => void) {
  return useMutation(async (id: string) => {
    const value = (await request.post(
      '/api/gateway/keys/' + encodeURIComponent(id) + '/reveal',
      {},
    )) as { key_id: string; key: string };
    onRevealed(value);
    return { key_id: value.key_id };
  });
}
export function useRenameGatewayKey() {
  const cache = useQueryClient();
  return useMutation(
    ({ id, name }: { id: string; name: string }) =>
      request.put('/api/gateway/keys/' + encodeURIComponent(id), { name }),
    {
      onSuccess: () => cache.invalidateQueries(['gateway-keys']),
    },
  );
}

export function useGatewayTokenRequests() {
  const { user } = useAuthContext();
  return useQuery<{ requests: GatewayTokenRequest[] }>(
    [QueryKeys.gatewayTokenRequests, user?.id],
    () => request.get('/api/gateway/token-requests'),
    { enabled: user?.provider === 'openid', retry: false, refetchInterval: 15000 },
  );
}
export function useRequestGatewayTokens() {
  const cache = useQueryClient();
  return useMutation({
    mutationKey: [MutationKeys.requestGatewayTokens],
    mutationFn: (body: GatewayTokenRequestInput) =>
      request.post('/api/gateway/token-requests', body),
    onSuccess: () => cache.invalidateQueries([QueryKeys.gatewayTokenRequests]),
  });
}
