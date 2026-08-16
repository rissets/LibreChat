import { URL } from 'node:url';
import net from 'node:net';

const PREFLIGHT_TIMEOUT_MS = 8_000;
const PLACEHOLDER = /(?:example\.(?:com|org|net)|changeme|replace[-_ ]?me|your[-_ ]|<[^>]+>|\$\{|undefined|null)/i;

type Provider = { name: string; value: string; request: RequestInit; validate: (body: unknown) => boolean };

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    return url.toString();
  } catch {
    return '[invalid URL]';
  }
}

const DOCKER_ONLY_HOSTS = new Set(['access-broker', 'searxng', 'department-tools']);

/** Validate URLs used by host-side preflight, without relying on compose config checks. */
export function validateHostPreflightUrl(name: string, value: string): URL {
  if (!value || PLACEHOLDER.test(value)) {
    throw new Error(`[e2e:bp] ${name} is missing or still contains a placeholder`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[e2e:bp] ${name} is not a valid HTTP(S) URL (${redactUrl(value)})`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`[e2e:bp] ${name} must use http:// or https:// (${redactUrl(value)})`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipVersion = net.isIP(hostname);
  // RFC 1918 172.16.0.0/12 is 172.16–172.31 (the boundary must be
  // matched as an octet, not as a textual prefix).
  const privateServiceIp = ipVersion === 4 &&
    (/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname) ||
      /^192\.168\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname));
  const dockerDnsName = DOCKER_ONLY_HOSTS.has(hostname) || (!ipVersion && hostname !== 'localhost' && !hostname.includes('.') && hostname !== 'host.docker.internal');
  if (privateServiceIp || dockerDnsName || hostname.endsWith('.internal')) {
    throw new Error(`[e2e:bp] ${name} must be host-reachable; Docker-only host is not allowed (${hostname})`);
  }
  return url;
}

function parseUrl(name: string, value: string): URL {
  return validateHostPreflightUrl(name, value);
}

function healthPath(value: string): string {
  const url = new URL(value);
  if (url.pathname === '/' || !url.pathname) url.pathname = '/health';
  return url.toString();
}

function searchPath(value: string): string {
  const url = new URL(value);
  if (url.pathname === '/' || !url.pathname) url.pathname = '/search';
  url.searchParams.set('q', 'bp-chat-preflight');
  url.searchParams.set('format', 'json');
  return url.toString();
}

async function requestJson(provider: Provider): Promise<unknown> {
  const expected = parseUrl(provider.name, provider.value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  let current = new URL(provider.value);
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(current, {
        ...provider.request,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects === 3) throw new Error('too many or malformed redirects');
        const next = new URL(location, current);
        if (next.hostname !== expected.hostname) throw new Error(`redirected to unexpected host ${next.hostname}`);
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`returned HTTP ${response.status}`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('returned malformed JSON');
      }
      if (!provider.validate(body)) throw new Error('returned an unexpected health/protocol response');
      return body;
    }
    throw new Error('redirect limit exceeded');
  } catch (error) {
    const detail = error instanceof Error && error.name === 'AbortError' ? 'timed out' : error instanceof Error ? error.message : 'request failed';
    throw new Error(`[e2e:bp] ${provider.name} preflight failed for ${redactUrl(provider.value)}: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyBpProviders(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // These requests run in the host runner, so only BP_E2E_* host URLs are valid.
  // The app's internal Docker URLs must never be used as host preflight targets.
  const providerUrl = validateHostPreflightUrl('BP_E2E_PROVIDER_URL', env.BP_E2E_PROVIDER_URL ?? '').toString();
  const searchUrl = validateHostPreflightUrl('BP_E2E_SEARCH_URL', env.BP_E2E_SEARCH_URL ?? '').toString();
  const mcpUrl = validateHostPreflightUrl('BP_E2E_ACCESS_BROKER_URL', env.BP_E2E_ACCESS_BROKER_URL ?? '').toString();
  await requestJson({
    name: 'BP Chat base URL', value: healthPath(providerUrl), request: { headers: { accept: 'application/json' } },
    validate: (body) => typeof body === 'object' && body !== null && ['ok', 'healthy'].includes(String((body as Record<string, unknown>).status).toLowerCase()),
  });
  await requestJson({
    name: 'SearXNG/web-search URL', value: searchPath(searchUrl), request: { headers: { accept: 'application/json' } },
    validate: (body) => typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).results),
  });
  await requestJson({
    name: 'department-tools MCP URL', value: mcpUrl,
    request: { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'bp-preflight', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'BP Chat E2E preflight', version: '1' } } }) },
    validate: (body) => {
      const result = (body as Record<string, unknown> | null)?.result as Record<string, unknown> | undefined;
      return typeof body === 'object' && body !== null && (body as Record<string, unknown>).jsonrpc === '2.0' && typeof result?.protocolVersion === 'string' && typeof (result?.serverInfo as Record<string, unknown> | undefined)?.name === 'string';
    },
  });
}
