export interface GatewayDeps {
  fetch: typeof fetch;
  issuer: string;
  bridgeURL: string;
  clientId: string;
  clientSecret: string;
  endpoint: string;
  audience: string;
  publicAPIURL?: string;
}
/** Deployment trust/credential configuration cannot be overridden by a user's config profile. */
export function gatewayConfig(): GatewayDeps | null {
  const endpoint = process.env.BPBATAM_GATEWAY_ENDPOINT;
  if (!endpoint) return null;
  const {
    OPENID_ISSUER: issuer,
    BPBATAM_BRIDGE_URL: bridgeURL,
    BPBATAM_LC_CLIENT_ID: clientId,
    BPBATAM_LC_CLIENT_SECRET: clientSecret,
  } = process.env;
  if (!issuer || !bridgeURL || !clientId || !clientSecret)
    throw new Error('GATEWAY_CONFIGURATION_REQUIRED');
  return {
    fetch,
    issuer,
    bridgeURL,
    clientId,
    clientSecret,
    endpoint,
    audience: process.env.BPBATAM_SERVICE_AUDIENCE ?? 'bpbatam-gateway',
    publicAPIURL: process.env.BPBATAM_PUBLIC_API_URL,
  };
}
