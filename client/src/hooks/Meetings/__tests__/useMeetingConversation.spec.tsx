import React from 'react';
import { webcrypto } from 'node:crypto';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invalidateMeetingAccess, useMeetingBoundary } from '~/data-provider/Meetings/access';
import { MeetingRuntimeProvider } from '~/components/Meetings/Runtime';
import useMeetingConversation from '../useMeetingConversation';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../../../components/Meetings/pcm.js?url', () => 'pcm.js', { virtual: true });

const meetingId = '10000000-0000-4000-8000-000000000001';
const chatId = '20000000-0000-4000-8000-000000000001';
const conversationId = `meeting-${meetingId}-${chatId}`;
const session = {
  id: meetingId,
  title: 'Planning',
  created_at: '',
  revision: 1,
  capture_state: 'not_started' as const,
  finalization_state: 'not_requested' as const,
  visibility: 'private' as const,
  artifact_classes: [],
};
function Boundary() {
  useMeetingBoundary('owner', meetingId);
  return null;
}
function setup(
  id = conversationId,
  boundary = false,
  onSubmit = jest.fn().mockReturnValue(true),
  stopGenerating = jest.fn(),
) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onAccepted = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={cache}>
      <MeetingRuntimeProvider>
        {boundary && <Boundary />}
        {children}
      </MeetingRuntimeProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    ({ id: route }) =>
      useMeetingConversation({
        conversationId: route,
        userId: 'owner',
        onSubmit,
        stopGenerating,
        onAccepted,
      }),
    { wrapper, initialProps: { id } },
  );
  return { ...hook, cache, onAccepted, onSubmit, stopGenerating };
}
beforeEach(() => {
  Object.defineProperty(crypto, 'subtle', {
    configurable: true,
    value: webcrypto.subtle,
  });
  sessionStorage.clear();
  jest.spyOn(dataService, 'getMeeting').mockResolvedValue(session);
  jest.spyOn(dataService, 'getMeetingLifecycle').mockImplementation(() => new Promise(() => {}));
});

it('delegates turn submission to native chat onSubmit and calls onAccepted when ready', async () => {
  const { result, onSubmit, onAccepted, cache } = setup();
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    result.current.ask({ text: 'What was decided?' });
  });
  expect(onSubmit).toHaveBeenCalledWith({ text: 'What was decided?' }, {});
  expect(onAccepted).toHaveBeenCalledWith('What was decided?');
  expect(result.current.failed).toBe(false);
  cache.clear();
});

it('refuses unsupported mutations and erases projected native messages when access is revoked', async () => {
  const { result, onSubmit, stopGenerating, cache } = setup();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.ask({ text: 'Retry' }, { isRegenerate: true })).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
  cache.setQueryData([QueryKeys.messages, conversationId], [{ text: 'Private answer' }]);
  act(() => invalidateMeetingAccess('owner', meetingId));
  expect(stopGenerating).toHaveBeenCalled();
  expect(cache.getQueryData([QueryKeys.messages, conversationId])).toBeUndefined();
  expect(result.current.unavailable).toBe(true);
  expect(result.current.ask({ text: 'Do not send' })).toBe(false);
  cache.clear();
});

it('leaves ordinary conversations outside the meeting transport', () => {
  const { result, onSubmit, cache } = setup('ordinary-chat');
  expect(result.current.isMeeting).toBe(false);
  expect(result.current.ask({ text: 'Hello' })).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(dataService.getMeeting).not.toHaveBeenCalled();
  cache.clear();
});

it('erases off-route meeting projections and history while preserving ordinary chats', async () => {
  const { result, cache, unmount } = setup();
  await waitFor(() => expect(result.current.ready).toBe(true));
  cache.setQueryData([QueryKeys.messages, conversationId], [{ text: 'Private answer' }]);
  cache.setQueryData([QueryKeys.messages, 'ordinary-chat'], [{ text: 'Ordinary answer' }]);
  cache.setQueryData([QueryKeys.allConversations], {
    pages: [
      {
        conversations: [
          { conversationId, title: 'Private meeting title' },
          { conversationId: 'ordinary-chat', title: 'Ordinary chat' },
        ],
      },
    ],
    pageParams: [],
  });
  unmount();
  invalidateMeetingAccess('owner', meetingId);
  expect(cache.getQueryData([QueryKeys.messages, conversationId])).toBeUndefined();
  expect(cache.getQueryData([QueryKeys.messages, 'ordinary-chat'])).toEqual([
    { text: 'Ordinary answer' },
  ]);
  expect(cache.getQueryData([QueryKeys.allConversations])).toEqual({
    pages: [{ conversations: [{ conversationId: 'ordinary-chat', title: 'Ordinary chat' }] }],
    pageParams: [],
  });
  cache.clear();
});

it('keeps the native composer blocked while a turn is pending or access is unavailable', async () => {
  const { result, onSubmit, cache } = setup();
  await waitFor(() => expect(result.current.ready).toBe(true));
  cache.setQueryData(
    [QueryKeys.messages, conversationId],
    [
      {
        conversationId,
        text: '',
        isCreatedByUser: false,
        metadata: {
          meeting: {
            meeting_id: meetingId,
            chat_id: chatId,
            operation_id: '30000000-0000-4000-8000-000000000001',
            state: 'processing',
            citations: [],
          },
        },
      },
    ],
  );
  expect(result.current.ask({ text: 'Do not start another answer' })).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
  cache.clear();
});
