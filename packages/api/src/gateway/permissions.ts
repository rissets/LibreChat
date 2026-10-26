import { permissionsSchema } from 'librechat-data-provider';
/** Per-user governance must reach both native middleware and the role response consumed by the UI. */
export function managedRoleProjection<T extends { permissions?: object }>(
  role: T,
  user: { governancePermissions?: Record<string, Record<string, boolean>> },
  ownRole: boolean,
): T {
  if (!ownRole || !user.governancePermissions) return role;
  const permissions: Record<string, Record<string, boolean>> = { ...role.permissions };
  for (const [family, override] of Object.entries(user.governancePermissions)) {
    permissions[family] = { ...permissions[family], ...override };
  }
  return { ...role, permissions };
}

export function nativeFeatureContract(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(permissionsSchema.shape).map(([family, schema]) => [
      family,
      Object.keys(schema.shape),
    ]),
  );
}
export function validManagedPermissions(value: Record<string, Record<string, boolean>>): boolean {
  const contract = nativeFeatureContract();
  return Object.entries(value).every(
    ([family, permissions]) =>
      contract[family] && Object.keys(permissions).every((key) => contract[family].includes(key)),
  );
}
