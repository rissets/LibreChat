import { z } from 'zod';
import { validManagedPermissions } from './permissions';
interface ManagedUserRecord {
  _id?: { toString(): string };
  openidId?: string;
  openidIssuer?: string;
  email?: string;
  governanceDisabled?: boolean;
  governancePermissions?: Record<string, Record<string, boolean>>;
}
interface ManagedUserWrite {
  name?: string;
  email?: string;
  provider?: string;
  role?: string;
  emailVerified?: boolean;
  openidId?: string;
  openidIssuer?: string;
  governanceDisabled?: boolean;
  governancePermissions?: Record<string, Record<string, boolean>>;
}

const inputSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('features'),
    userId: z.string().regex(/^[a-f\d]{24}$/i),
    permissions: z.record(z.string(), z.record(z.string(), z.boolean())),
  }),
  z.object({
    op: z.literal('provision'),
    subject: z.string().uuid(),
    issuer: z.string().url(),
    email: z.string().email(),
    name: z.string().min(1),
  }),
  z.object({
    op: z.literal('link'),
    userId: z.string().regex(/^[a-f\d]{24}$/i),
    subject: z.string().uuid(),
    issuer: z.string().url(),
  }),
  z.object({
    op: z.literal('profile'),
    userId: z.string().regex(/^[a-f\d]{24}$/i),
    name: z.string().min(1),
    email: z.string().email(),
  }),
  z.object({
    op: z.literal('active'),
    userId: z.string().regex(/^[a-f\d]{24}$/i),
    active: z.boolean(),
  }),
]);
interface UserDeps {
  findUsers: (
    filter: object,
    projection: string,
    options: { limit: number },
  ) => Promise<ManagedUserRecord[]>;
  getUserById: (id: string) => Promise<ManagedUserRecord | null>;
  createUser: (data: ManagedUserWrite) => Promise<unknown>;
  updateUser: (id: string, data: ManagedUserWrite) => Promise<ManagedUserRecord | null>;
  deleteAllUserSessions: (options: { userId: string }) => Promise<unknown>;
}
export function createManagedUserManager(deps: UserDeps) {
  return async (body: unknown): Promise<{ id: string; subject?: string; active: boolean }> => {
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) throw new ManagedUserError('INVALID_MANAGED_USER');
    const input = parsed.data;
    let user: ManagedUserRecord | null = null;
    if (input.op === 'provision') {
      if (input.issuer !== process.env.OPENID_ISSUER) throw new ManagedUserError('ISSUER_MISMATCH');
      user =
        (
          await deps.findUsers(
            { openidId: input.subject, openidIssuer: input.issuer },
            '_id openidId governanceDisabled',
            { limit: 1 },
          )
        )[0] ?? null;
      if (!user) {
        const conflicts = await deps.findUsers({ email: input.email }, '_id', { limit: 1 });
        if (conflicts.length) throw new ManagedUserError('EXPLICIT_IDENTITY_LINK_REQUIRED');
        await deps.createUser({
          email: input.email,
          name: input.name,
          emailVerified: true,
          provider: 'openid',
          openidId: input.subject,
          openidIssuer: input.issuer,
          role: 'USER',
        });
        user =
          (
            await deps.findUsers(
              { openidId: input.subject, openidIssuer: input.issuer },
              '_id openidId governanceDisabled',
              { limit: 1 },
            )
          )[0] ?? null;
      }
    } else {
      user = await deps.getUserById(input.userId);
      if (!user) throw new ManagedUserError('USER_NOT_FOUND');
      if (input.op === 'link') {
        if (
          input.issuer !== process.env.OPENID_ISSUER ||
          (user.openidId && (user.openidId !== input.subject || user.openidIssuer !== input.issuer))
        )
          throw new ManagedUserError('SUBJECT_BINDING_CONFLICT');
        user = await deps.updateUser(input.userId, {
          provider: 'openid',
          openidId: input.subject,
          openidIssuer: input.issuer,
        });
      } else if (input.op === 'features') {
        if (!validManagedPermissions(input.permissions))
          throw new ManagedUserError('INVALID_NATIVE_PERMISSIONS');
        user = await deps.updateUser(input.userId, { governancePermissions: input.permissions });
      } else if (input.op === 'profile') {
        user = await deps.updateUser(input.userId, { name: input.name, email: input.email });
      } else {
        user = await deps.updateUser(input.userId, { governanceDisabled: !input.active });
        if (!input.active) await deps.deleteAllUserSessions({ userId: input.userId });
      }
    }
    if (!user?._id) throw new ManagedUserError('USER_NOT_FOUND');
    return { id: String(user._id), subject: user.openidId, active: !user.governanceDisabled };
  };
}

export class ManagedUserError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
  ) {
    super(code);
  }
}
