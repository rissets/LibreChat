import { isAxiosError } from 'axios';

export function meetingLimitError(cause: unknown): 'duration' | 'concurrency' | null {
  if (!isAxiosError<{ code?: string }>(cause)) return null;
  const code = cause.response?.data?.code;
  if (code === 'MEETING_DURATION_LIMIT') return 'duration';
  if (code === 'MEETING_CONCURRENCY_LIMIT') return 'concurrency';
  return null;
}
