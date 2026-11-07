import { webcrypto } from 'node:crypto';
import {
  getMeetingAttempt,
  settleMeetingAttempt,
  clearMeetingAttempts,
  setMeetingAttemptSession,
} from './attempts';

const scope = { userId: 'owner', meetingId: 'meeting', chatId: 'chat' };
beforeEach(() => {
  sessionStorage.clear();
  clearMeetingAttempts();
  Object.defineProperty(crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
});

it('retains unresolved operation identity on reload in the same authenticated session without storing question text', async () => {
  setMeetingAttemptSession('owner:identity-session');
  const id = await getMeetingAttempt(scope, 'Private decision question');
  let reloaded!: typeof import('./attempts');
  jest.isolateModules(() => {
    reloaded = jest.requireActual('./attempts');
  });
  reloaded.setMeetingAttemptSession('owner:identity-session');
  expect(await reloaded.getMeetingAttempt(scope, 'Private decision question')).toBe(id);
  expect(JSON.stringify(sessionStorage)).not.toContain('Private decision question');
  expect(await reloaded.getMeetingAttempt(scope, 'Changed question')).not.toBe(id);
});

it('separates accounts, meetings and chats and erases only revoked scope', async () => {
  const id = await getMeetingAttempt(scope, 'Question');
  const otherChat = { ...scope, chatId: 'other-chat' };
  const otherId = await getMeetingAttempt(otherChat, 'Question');
  expect(otherId).not.toBe(id);
  expect(await getMeetingAttempt({ ...scope, userId: 'other-owner' }, 'Question')).not.toBe(id);
  expect(await getMeetingAttempt({ ...scope, meetingId: 'other-meeting' }, 'Question')).not.toBe(
    id,
  );
  clearMeetingAttempts(scope);
  expect(await getMeetingAttempt(scope, 'Question')).not.toBe(id);
  expect(await getMeetingAttempt(otherChat, 'Question')).toBe(otherId);
});

it('erases identity on logout or identity-session change and consumes only the acknowledged operation', async () => {
  setMeetingAttemptSession('owner:session-one');
  const first = await getMeetingAttempt(scope, 'Question');
  const next = await getMeetingAttempt(scope, 'Next question');
  settleMeetingAttempt(scope, first);
  expect(await getMeetingAttempt(scope, 'Next question')).toBe(next);
  setMeetingAttemptSession();
  expect(await getMeetingAttempt(scope, 'Next question')).not.toBe(next);
  const beforeChange = await getMeetingAttempt(scope, 'Question');
  setMeetingAttemptSession('owner:session-two');
  expect(await getMeetingAttempt(scope, 'Question')).not.toBe(beforeChange);
});

it('refuses a new identity at capacity while keeping unresolved retries available', async () => {
  const first = await getMeetingAttempt(scope, 'Question 0');
  for (let index = 1; index < 32; index++) await getMeetingAttempt(scope, `Question ${index}`);
  await expect(getMeetingAttempt(scope, 'Overflow')).rejects.toThrow(
    'Unresolved meeting attempts limit',
  );
  expect(await getMeetingAttempt(scope, 'Question 0')).toBe(first);
});

it('keeps retries available in memory when browser storage writes are unavailable', async () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  const id = await getMeetingAttempt(scope, 'Retry without storage');
  expect(await getMeetingAttempt(scope, 'Retry without storage')).toBe(id);
});

it('does not restore an identity after access was erased while its fingerprint was pending', async () => {
  const pending = getMeetingAttempt(scope, 'Question being prepared');
  clearMeetingAttempts(scope);
  await expect(pending).rejects.toThrow('Meeting session changed');
});
