import { useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import { useMeetingQuery, useMeetingMutation } from './access';

export function useMeetingWorkspace(userId: string | undefined, meetingId: string) {
  return useMeetingQuery(
    [QueryKeys.meetingWorkspace, userId, meetingId],
    ({ signal }) => dataService.getMeetingWorkspace(meetingId, signal),
    {
      enabled: !!userId && !!meetingId,
      retry: false,
      refetchInterval: (data) =>
        data?.live_enhance?.state === 'queued' ||
        data?.live_enhance?.state === 'processing' ||
        data?.synthesis?.state === 'queued' ||
        data?.synthesis?.state === 'processing'
          ? 3000
          : false,
    },
  );
}
export function useSaveMeetingWorkspace(userId: string | undefined, meetingId: string) {
  const cache = useQueryClient();
  return useMeetingMutation(dataService.saveMeetingWorkspace, {
    mutationKey: [MutationKeys.saveMeetingWorkspace, userId, meetingId],
    retry: false,
    onSuccess: (data) => cache.setQueryData([QueryKeys.meetingWorkspace, userId, meetingId], data),
  });
}
export function useMeetingChats(userId: string | undefined, enabled: boolean) {
  return useMeetingQuery(
    [QueryKeys.meetingChats, userId],
    ({ signal }) => dataService.getMeetingChats(signal),
    {
      enabled: !!userId && enabled,
      retry: false,
      refetchInterval: 10000,
    },
  );
}
export function useOpenMeetingChat(userId: string | undefined, meetingId: string) {
  const cache = useQueryClient();
  return useMeetingMutation(dataService.openMeetingChat, {
    mutationKey: [MutationKeys.openMeetingChat, userId, meetingId],
    retry: false,
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries([QueryKeys.meetingWorkspace, userId, meetingId]),
        cache.invalidateQueries([QueryKeys.meetingChats, userId]),
        cache.invalidateQueries([QueryKeys.allConversations]),
      ]),
  });
}
export function useMeetingChat(userId: string | undefined, meetingId: string, chatId: string) {
  return useMeetingQuery(
    [QueryKeys.meetingChat, userId, meetingId, chatId],
    ({ signal }) => dataService.getMeetingChat(chatId, signal),
    {
      enabled: !!userId && !!meetingId && !!chatId,
      retry: false,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchInterval: 4000,
    },
  );
}
export function useSendMeetingChat(userId: string | undefined, meetingId: string, chatId: string) {
  const cache = useQueryClient();
  return useMeetingMutation(dataService.sendMeetingChat, {
    mutationKey: [MutationKeys.sendMeetingChat, userId, meetingId],
    retry: false,
    onSuccess: (_data, variables) => {
      const resolvedChatId = variables.chatId || chatId;
      return Promise.all([
        cache.invalidateQueries([QueryKeys.meetingChat, userId, meetingId, resolvedChatId]),
        cache.invalidateQueries([
          QueryKeys.messages,
          `meeting-${meetingId}-${resolvedChatId}`,
        ]),
      ]);
    },
  });
}
export function useDeleteMeetingChat(userId: string | undefined, meetingId: string) {
  const cache = useQueryClient();
  return useMeetingMutation(dataService.deleteMeetingChat, {
    mutationKey: [MutationKeys.deleteMeetingChat, userId, meetingId],
    retry: false,
    onSuccess: () => {
      cache.removeQueries([QueryKeys.meetingChat, userId, meetingId]);
      void cache.invalidateQueries([QueryKeys.meetingWorkspace, userId, meetingId]);
      return cache.invalidateQueries([QueryKeys.meetingChats, userId]);
    },
  });
}

export function meetingChatPath(meetingId: string, chatId: string) {
  return '/c/meeting-' + encodeURIComponent(meetingId) + '-' + encodeURIComponent(chatId);
}
export { parseMeetingChatPath } from './path';
