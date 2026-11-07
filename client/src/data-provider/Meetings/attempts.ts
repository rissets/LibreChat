import { z } from 'zod';

const key = 'meeting-chat-attempts-v1';
// Safety ceiling for unresolved identities in this tab; never evict one to permit a new send.
const capacity = 32;
const scopeSchema = z.object({ userId: z.string(), meetingId: z.string(), chatId: z.string() });
const attemptSchema = scopeSchema.extend({ id: z.string().uuid(), fingerprint: z.string() });
const stateSchema = z.object({
  session: z.string().optional(),
  salt: z.string().uuid(),
  attempts: z.array(attemptSchema).max(capacity),
});
type Scope = z.infer<typeof scopeSchema>;
type State = z.infer<typeof stateSchema>;
let fallback: State | undefined;
let storageUnavailable = false;
let generation = 0;

function read(): State {
  if (storageUnavailable && fallback) return fallback;
  try {
    const stored = sessionStorage.getItem(key);
    // An explicitly cleared browser store also clears the in-memory mirror.
    if (!stored) return { salt: crypto.randomUUID(), attempts: [] };
    const parsed = stateSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
  } catch {
    if (fallback) return fallback;
  }
  return { salt: crypto.randomUUID(), attempts: [] };
}
function write(state: State) {
  fallback = state;
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // Storage-disabled browsers retain identity across route remounts for this document only.
  }
}
const matches = (row: Scope, scope: Partial<Scope>) =>
  (!scope.userId || row.userId === scope.userId) &&
  (!scope.meetingId || row.meetingId === scope.meetingId) &&
  (!scope.chatId || row.chatId === scope.chatId);

/** A salted digest prevents retaining the private question in browser retry metadata. */
export async function getMeetingAttempt(scope: Scope, question: string): Promise<string> {
  const state = read();
  const epoch = generation;
  write(state);
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([state.salt, scope.userId, scope.meetingId, scope.chatId, question]),
    ),
  );
  const fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  // Digesting yields: reread so simultaneous panes cannot overwrite each other's identities.
  const current = read();
  if (generation !== epoch || current.salt !== state.salt)
    throw new Error('Meeting session changed');
  const existing = current.attempts.find(
    (row) => matches(row, scope) && row.fingerprint === fingerprint,
  );
  if (existing) return existing.id;
  if (current.attempts.length >= capacity) throw new Error('Unresolved meeting attempts limit');
  const id = crypto.randomUUID();
  current.attempts.push({ ...scope, fingerprint, id });
  write(current);
  return id;
}

export function settleMeetingAttempt(scope: Scope, id: string) {
  const state = read();
  state.attempts = state.attempts.filter((row) => !matches(row, scope) || row.id !== id);
  write(state);
}

export function clearMeetingAttempts(scope: Partial<Scope> = {}) {
  generation++;
  const state = read();
  state.attempts = state.attempts.filter((row) => !matches(row, scope));
  write(state);
}

/** Reload preserves the same identity session; logout/account/session changes erase it. */
export function setMeetingAttemptSession(session?: string) {
  const state = read();
  if (!session || state.session !== session) {
    generation++;
    state.attempts = [];
  }
  state.session = session;
  write(state);
}
