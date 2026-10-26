const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Registered tools are the last owner-inspected snapshot; connection status is a separate native read. */
export function registeredMCPTools(row: Record<string, unknown>, serverName: string): object {
  const config = object(row.config);
  const inspected = typeof config?.tools === 'string';
  const names = inspected
    ? String(config.tools)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
  return {
    serverName,
    tools: names.map((name) => ({ name })),
    tool_count: names.length,
    catalog_source: 'registered_snapshot',
    catalog_state: inspected ? 'inspected' : 'uninspected',
    inspected_at: config?.updatedAt ?? row.updatedAt ?? null,
    requires_oauth: config?.requiresOAuth === true,
  };
}

export function mcpMetadata(value: unknown, serverName: string): object | null {
  const body = object(value);
  if (!body || body.serverName !== serverName || body.success !== true) return null;
  const fields = [
    'serverName',
    'connectionStatus',
    'requiresOAuth',
    'requestScoped',
    'configurationState',
    'authorizationState',
    'authorizationGeneration',
  ];
  return Object.fromEntries(
    fields.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]),
  );
}
