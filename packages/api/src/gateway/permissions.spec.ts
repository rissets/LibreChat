import type { SystemCapability } from '@librechat/data-schemas';
import {
  managedRoleProjection,
  validManagedPermissions,
  nativeFeatureContract,
} from './permissions';
import { createGovernanceGrantAuthority } from './delegation';
import { capabilityStore } from '../middleware/capabilities';
describe('managed role projection', () => {
  it('overrides only the caller role without mutating the shared definition', () => {
    const role = {
      name: 'USER',
      permissions: { MULTI_CONVO: { USE: true }, PROMPTS: { USE: true, CREATE: true } },
    };
    const user = {
      governancePermissions: { MULTI_CONVO: { USE: false }, PROMPTS: { CREATE: false } },
    };
    expect(managedRoleProjection(role, user, true).permissions).toEqual({
      MULTI_CONVO: { USE: false },
      PROMPTS: { USE: true, CREATE: false },
    });
    expect(role.permissions.MULTI_CONVO.USE).toBe(true);
    expect(managedRoleProjection(role, user, false)).toBe(role);
  });
});

it('validates permission fields against the native family schema', () => {
  expect(Object.keys(nativeFeatureContract())).toHaveLength(17);
  expect(
    validManagedPermissions({ PEOPLE_PICKER: { VIEW_USERS: false }, MULTI_CONVO: { USE: false } }),
  ).toBe(true);
  expect(validManagedPermissions({ PROMPTS: { VIEW_USERS: true } })).toBe(false);
  expect(validManagedPermissions({ UNKNOWN: { USE: true } })).toBe(false);
});

it('keeps native grant reads on database authority except in the authenticated service scope', async () => {
  const deps = {
    getHeldCapabilities: jest.fn(async () => new Set<SystemCapability>()),
    hasCapabilityForPrincipals: jest.fn(async () => false),
  };
  const authority = createGovernanceGrantAuthority(deps);
  const input = {
    principals: [],
    capabilities: ['manage:roles'] as SystemCapability[],
  };
  expect((await authority.getHeldCapabilities(input)).size).toBe(0);
  await capabilityStore.run(
    {
      principals: new Map(),
      results: new Map(),
      delegation: {
        userId: 'verified-service-actor',
        capabilities: new Set(),
        nativeGrantAuthority: true,
      },
    },
    async () => {
      expect(await authority.getHeldCapabilities(input)).toEqual(new Set(['manage:roles']));
      expect(
        await authority.hasCapabilityForPrincipals({
          principals: [],
          capability: 'invalid-capability' as SystemCapability,
        }),
      ).toBe(false);
    },
  );
  expect((await authority.getHeldCapabilities(input)).size).toBe(0);
});
