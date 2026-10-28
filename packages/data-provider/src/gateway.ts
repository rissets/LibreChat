export interface GatewayWindow {
  window: '5h' | '7d' | '30d';
  limit: string;
  used: string;
  reserved: string;
  available: string;
  reset_at: string;
}
export interface GatewayAccount {
  endpoint: string;
  api_base_url: string | null;
  wallet: { balance: string; reserved: string; available: string };
  limits: { revision: number; windows: GatewayWindow[] };
  totals: {
    requests: number;
    tokens: number;
    settled: number | null;
    uncertain: number | null;
    pending: number | null;
  };
  models: { model: string; requests: number; tokens: number }[];
  offers: { id: string; capabilities: string[] }[];
}
export interface GatewayKey {
  key_id: string;
  name: string;
  created_at: string;
  key_prefix: string | null;
  requests: number;
  tokens: number;
}

export interface GatewayTokenRequest {
  id: string;
  amount: number | string;
  status: string;
  reason: string;
  created_at: string;
}
export interface GatewayTokenRequestInput {
  amount: number;
  reason: string;
  request_id: string;
}
