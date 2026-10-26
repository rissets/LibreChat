import { registeredMCPTools, mcpMetadata } from './mcp';

it('projects connection status without credentials or provider payloads', () => {
  const status = {
    success: true,
    serverName: 'owned',
    connectionStatus: 'connected',
    requiresOAuth: false,
    apiKey: 'private-secret',
  };
  expect(mcpMetadata(status, 'owned')).toEqual({
    serverName: 'owned',
    connectionStatus: 'connected',
    requiresOAuth: false,
  });
  expect(mcpMetadata(status, 'other')).toBeNull();
  expect(mcpMetadata({ error: 'native-error' }, 'owned')).toBeNull();
});

it('labels the last owner-inspected tool snapshot and omits secrets and private schemas', () => {
  const result = registeredMCPTools(
    {
      updatedAt: '2026-10-26',
      config: {
        tools: 'search, explain',
        headers: { Authorization: 'private-secret' },
        toolFunctions: { search: { description: 'private content' } },
      },
    },
    'owned',
  );
  expect(result).toEqual({
    serverName: 'owned',
    tools: [{ name: 'search' }, { name: 'explain' }],
    tool_count: 2,
    catalog_source: 'registered_snapshot',
    catalog_state: 'inspected',
    inspected_at: '2026-10-26',
    requires_oauth: false,
  });
  expect(registeredMCPTools({ config: {} }, 'owned')).toMatchObject({
    catalog_state: 'uninspected',
    tool_count: 0,
  });
  expect(registeredMCPTools({ config: { tools: '' } }, 'owned')).toMatchObject({
    catalog_state: 'inspected',
    tool_count: 0,
  });
});
