import React from 'react';
import { AxiosError } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  invalidateMeetingAccess,
  observeMeetingLifecycle,
  setMeetingSession,
  subscribeMeetingAccessLoss,
  useMeetingQuery,
} from '../access';

const userId = 'user-baseline';
const meetingId = '10000000-0000-4000-8000-000000000001';

function lifecycle(available: boolean) {
  return {
    meeting_id: meetingId,
    generation: 0,
    policy: { configured: true, seconds: {}, clocks: {}, policy_revisions: [] },
    classes: { answers: { available }, transcript: { available } },
    removals: [],
  };
}

describe('meeting lifecycle baseline', () => {
  beforeEach(() => {
    // A fresh login session clears the stored baseline, like a page load.
    setMeetingSession(userId, undefined);
  });

  it('does not erase meeting data on the first snapshot after a load', () => {
    const clear = jest.fn();
    const stop = subscribeMeetingAccessLoss({ userId, meetingId }, clear);

    act(() => observeMeetingLifecycle(userId, meetingId, lifecycle(false)));

    expect(clear).not.toHaveBeenCalled();
    stop();
  });

  it('erases meeting data when an observed class later becomes unavailable', () => {
    const clear = jest.fn();
    const stop = subscribeMeetingAccessLoss({ userId, meetingId }, clear);
    act(() => observeMeetingLifecycle(userId, meetingId, lifecycle(true)));

    act(() => observeMeetingLifecycle(userId, meetingId, lifecycle(false)));

    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear.mock.calls[0][0]).toBe('lifecycle');
    stop();
  });

  it('does not fail refetched workspace/transcript/voice queries on hidden revalidation or receipt drift', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    let calls = 0;
    const { result } = renderHook(
      () =>
        useMeetingQuery(['meetingWorkspace', userId, meetingId], async () => {
          calls += 1;
          if (calls === 1) {
            throw new AxiosError('drift', undefined, undefined, undefined, {
              status: 403,
              statusText: 'Forbidden',
              headers: {},
              config: {} as never,
              data: { code: 'MEETING_DELIVERY_CHANGED' },
            });
          }
          return { ok: calls };
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual({ ok: 2 }));
    expect(result.current.isError).toBe(false);

    act(() => {
      invalidateMeetingAccess(userId, meetingId, 'hidden');
      invalidateMeetingAccess(userId, meetingId, 'hidden');
    });
    await waitFor(() => expect(result.current.data?.ok).toBeGreaterThanOrEqual(3));
    expect(result.current.isError).toBe(false);
    client.clear();
  });
});