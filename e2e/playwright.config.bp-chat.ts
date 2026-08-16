import { PlaywrightTestConfig } from '@playwright/test';
import mainConfig from './playwright.config';
import dotenv from 'dotenv';

dotenv.config();

// These URLs are fetched by the host-side Playwright preflight. Docker service DNS
// (access-broker/searxng/department-tools) is intentionally not valid here. Set these
// when using port forwards or a non-default BP deployment; do not fake reachability.
const hostDefaults = {
  BP_E2E_PROVIDER_URL: 'http://127.0.0.1:8010/health/live',
  BP_E2E_SEARCH_URL: 'http://127.0.0.1:8081/search',
  BP_E2E_ACCESS_BROKER_URL: 'http://127.0.0.1:8090/mcp',
};
for (const [name, value] of Object.entries(hostDefaults)) process.env[name] ??= value;
process.env.BP_CHAT_PROVIDER_URL ??= process.env.BP_E2E_PROVIDER_URL;
process.env.BP_CHAT_SEARCH_URL ??= process.env.BP_E2E_SEARCH_URL;
process.env.BP_CHAT_ACCESS_BROKER_URL ??= process.env.BP_E2E_ACCESS_BROKER_URL;

for (const name of Object.keys(hostDefaults)) {
  const value = process.env[name] ?? '';
  if (/https?:\/\/(access-broker|searxng|department-tools)(?::|\/|$)/i.test(value)) {
    throw new Error(`[e2e:bp] ${name} must be host-reachable; Docker service DNS is not valid from the host`);
  }
}

const config: PlaywrightTestConfig = {
  ...mainConfig,
  // This is the browser-facing URL configured by the BP compose deployment.
  // Provider URLs above are service-network URLs and are preflighted from that network.
  baseURL: process.env.BP_CHAT_BASE_URL ?? 'http://app.bpai.localhost:8080',
  testDir: __dirname,
  testMatch: 'bp-chat-tools.spec.ts',
  retries: 0,
  globalSetup: require.resolve('./setup/global-setup.bp'),
  globalTeardown: require.resolve('./setup/global-teardown.local'),
  webServer: undefined,
  fullyParallel: false,
};

export default config;
