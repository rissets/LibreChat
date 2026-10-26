import { useGatewayAccount } from '~/data-provider/Gateway';
import { useCallback } from 'react';
import { getResponseSender, getEphemeralSender, isAgentsEndpoint } from 'librechat-data-provider';
import type { TEndpointOption, TEndpointsConfig } from 'librechat-data-provider';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { getModelSpec } from '~/utils';

/**
 * Mirrors the server's sender resolution (`modelLabel` → spec label → endpoint
 * `modelDisplayLabel` → `getResponseSender`) so the optimistic streaming label
 * and composer placeholder match the persisted `message.sender`.
 *
 * Agent conversations are exempt from the label chain: their display name is
 * the agent's, and surfacing model or spec labels would reveal the underlying
 * model an agent author may intend to keep private.
 */
export default function useGetSender() {
  const gateway = useGatewayAccount();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  return useCallback(
    (endpointOption: TEndpointOption) => {
      if (gateway.data?.endpoint === endpointOption.endpoint && endpointOption.model)
        return endpointOption.model;
      const { modelDisplayLabel } = endpointsConfig?.[endpointOption.endpoint ?? ''] ?? {};
      if (isAgentsEndpoint(endpointOption.endpoint)) {
        return getResponseSender({ ...endpointOption, modelDisplayLabel });
      }
      const modelSpec = getModelSpec({ specName: endpointOption.spec, startupConfig });
      const sender = getEphemeralSender({
        modelLabel: endpointOption.modelLabel,
        specLabel: modelSpec?.label,
        modelDisplayLabel,
      });
      return sender || getResponseSender({ ...endpointOption, modelDisplayLabel });
    },
    [endpointsConfig, startupConfig, gateway.data?.endpoint],
  );
}
