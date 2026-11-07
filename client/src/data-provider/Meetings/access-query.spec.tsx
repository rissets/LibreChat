import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMeetingAccess } from './index';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

it('hides meeting history when disabled and restores it after access is enabled again', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = {
    pages: [
      {
        conversations: [
          { conversationId: 'ordinary-chat', title: 'Ordinary conversation' },
          {
            conversationId:
              'meeting-10000000-0000-4000-8000-000000000001-20000000-0000-4000-8000-000000000001',
            title: 'Private meeting',
          },
        ],
      },
    ],
    pageParams: [],
  };
  let allowed = true;
  jest.spyOn(dataService, 'getMeetingAccess').mockImplementation(async () => ({
    allowed,
    policy_revisions: [],
  }));
  cache.setQueryData([QueryKeys.allConversations], history);
  function History() {
    useQuery([QueryKeys.allConversations], async () => history, { staleTime: Infinity });
    return null;
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={cache}>
      <History />
      {children}
    </QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useMeetingAccess('owner'), { wrapper });
  await waitFor(() => expect(result.current.data?.allowed).toBe(true));
  allowed = false;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() =>
    expect(cache.getQueryData([QueryKeys.allConversations])).toEqual({
      ...history,
      pages: [{ conversations: [history.pages[0].conversations[0]] }],
    }),
  );
  allowed = true;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(cache.getQueryData([QueryKeys.allConversations])).toEqual(history));
  unmount();
  cache.clear();
});
