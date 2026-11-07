import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dataService, MutationKeys, QueryKeys } from 'librechat-data-provider';
import { useMeetingMutation as useMutation, useMeetingQuery as useQuery } from './access';
import { invalidateMeetingAccess, observeMeetingLifecycle } from './access';

export function useMeetingAccess(
  userId?: string,
  enabled = true,
  refetchInterval: number | false = 5000,
) {
  const cache = useQueryClient();
  const previous = useRef<{ userId?: string; allowed: boolean }>();
  return useQuery(
    [QueryKeys.meetingAccess, userId],
    ({ signal }) => dataService.getMeetingAccess(signal),
    {
      enabled: !!userId && enabled,
      retry: false,
      staleTime: 0,
      refetchInterval,
      onSuccess: (data) => {
        const restored =
          previous.current?.allowed === false && previous.current.userId === userId && data.allowed;
        previous.current = { userId, allowed: data.allowed };
        if (!data.allowed) invalidateMeetingAccess(userId);
        else if (restored) {
          void cache.invalidateQueries([QueryKeys.allConversations]);
          void cache.invalidateQueries([QueryKeys.archivedConversations]);
          void cache.invalidateQueries([QueryKeys.meetingChats, userId]);
        }
      },
    },
  );
}
export function useMeetingVoice(userId: string | undefined, id: string) {
  return useQuery(
    [QueryKeys.meetingVoice, userId, id],
    ({ signal }) => dataService.getMeetingVoice(id, signal),
    {
      enabled: !!userId && !!id,
      retry: false,
      refetchInterval: (data) =>
        data?.questions.some((q) => ['accepted', 'recording', 'processing'].includes(q.state))
          ? 2000
          : false,
    },
  );
}
export function useBeginMeetingVoice(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.beginMeetingVoice, {
    mutationKey: [MutationKeys.beginMeetingVoice, userId, id],
    retry: false,
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries([QueryKeys.meetingVoice, userId, id]),
        cache.invalidateQueries(['meetingAssistant', userId, id]),
      ]),
  });
}
export function useSubmitMeetingVoice(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.submitMeetingVoice, {
    mutationKey: [MutationKeys.submitMeetingVoice, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingVoice, userId, id]),
  });
}
export function useCancelMeetingVoice(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.cancelMeetingVoice, {
    mutationKey: [MutationKeys.cancelMeetingVoice, userId, id],
    retry: false,
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries([QueryKeys.meetingVoice, userId, id]),
        cache.invalidateQueries(['meetingAssistant', userId, id]),
      ]),
  });
}
export function useMeetings(userId?: string, enabled = false, page = 1) {
  return useQuery(
    [QueryKeys.meetings, userId, page],
    ({ signal }) => dataService.getMeetings(signal, page),
    {
      enabled: !!userId && enabled,
      retry: false,
    },
  );
}
export function useMeeting(userId?: string, id?: string, enabled = false) {
  return useQuery(
    [QueryKeys.meeting, userId, id],
    ({ signal }) => dataService.getMeeting(id ?? '', signal),
    {
      enabled: !!userId && !!id && enabled,
      retry: false,
      refetchInterval: (data) => (data?.capture_state === 'capturing' ? 3000 : false),
    },
  );
}
export function useMeetingLifecycle(userId?: string, id?: string, enabled = false) {
  return useQuery(
    [QueryKeys.meetingLifecycle, userId, id],
    ({ signal }) => dataService.getMeetingLifecycle(id ?? '', signal),
    {
      enabled: !!userId && !!id && enabled,
      retry: false,
      staleTime: 0,
      refetchInterval: 15000,
      onSuccess: (value) => observeMeetingLifecycle(userId, id ?? '', value),
    },
  );
}
export function useCreateMeeting(userId?: string) {
  const cache = useQueryClient();
  return useMutation(dataService.createMeeting, {
    mutationKey: [MutationKeys.createMeeting, userId],
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetings, userId]),
  });
}

export function useMeetingTranscript(userId: string | undefined, id: string) {
  return useQuery(
    [QueryKeys.meetingTranscript, userId, id],
    ({ signal }) => dataService.getMeetingTranscript(id, signal),
    {
      enabled: !!userId && !!id,
      retry: false,
      refetchInterval: (data) =>
        data?.capture?.state === 'capturing' ||
        data?.acknowledgements.some((item) => ['accepted', 'processing'].includes(item.state))
          ? 3000
          : false,
    },
  );
}
export function useMeetingCapture(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.changeMeetingCapture, {
    mutationKey: [MutationKeys.changeMeetingCapture, userId, id],
    retry: false,
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries([QueryKeys.meeting, userId, id]),
        cache.invalidateQueries([QueryKeys.meetingTranscript, userId, id]),
      ]),
  });
}
export function useMeetingAudio(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.submitMeetingAudio, {
    mutationKey: [MutationKeys.submitMeetingAudio, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingTranscript, userId, id]),
  });
}
export function useMeetingFinalization(userId: string | undefined, id: string, version?: number) {
  return useQuery(
    [QueryKeys.meetingFinalization, userId, id, version],
    ({ signal }) => dataService.getMeetingFinalization(id, version, signal),
    {
      enabled: !!userId && !!id,
      retry: false,
      refetchInterval: (data) =>
        data && ['queued', 'running'].includes(data.state) ? 2000 : false,
    },
  );
}
export function useFinalizeMeeting(userId: string | undefined, id: string, retry = false) {
  const cache = useQueryClient();
  return useMutation(retry ? dataService.retryMeetingFinalization : dataService.finalizeMeeting, {
    mutationKey: [
      retry ? MutationKeys.retryMeetingFinalization : MutationKeys.finalizeMeeting,
      userId,
      id,
    ],
    retry: false,
    onSuccess: (data) => {
      cache.setQueryData([QueryKeys.meetingFinalization, userId, id, undefined], data);
      return cache.invalidateQueries([QueryKeys.meeting, userId, id]);
    },
  });
}
export function useCorrectMeetingResult(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.correctMeetingResult, {
    mutationKey: [MutationKeys.correctMeetingResult, userId, id],
    retry: false,
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries([QueryKeys.meetingFinalization, userId, id]),
        cache.invalidateQueries([QueryKeys.meetingTranscript, userId, id]),
      ]),
  });
}
export function useReviewMeetingResult(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.reviewMeetingResult, {
    mutationKey: [MutationKeys.reviewMeetingResult, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingFinalization, userId, id]),
  });
}
export function useMeetingFinalEvidence(
  userId: string | undefined,
  id: string,
  segmentId?: string,
  version?: number,
  revision?: number,
) {
  return useQuery(
    [QueryKeys.meetingFinalEvidence, userId, id, segmentId, version, revision],
    ({ signal }) =>
      dataService.getMeetingFinalEvidence(id, segmentId ?? '', version ?? 1, revision ?? 1, signal),
    {
      enabled: !!userId && !!segmentId && !!version && !!revision,
      retry: false,
      staleTime: 0,
      refetchInterval: 3000,
    },
  );
}

export function useMeetingAssistant(userId: string | undefined, id: string) {
  return useQuery(
    ['meetingAssistant', userId, id],
    ({ signal }) => dataService.getMeetingAssistant(id, signal),
    {
      enabled: !!userId && !!id,
      retry: false,
      refetchInterval: 5000,
    },
  );
}
export function useAskMeetingAssistant(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.askMeetingAssistant, {
    mutationKey: ['askMeetingAssistant', userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries(['meetingAssistant', userId, id]),
  });
}
export function useMeetingEvidence(
  userId: string | undefined,
  id: string,
  operationId?: string,
  segmentId?: string,
  revision?: number,
) {
  return useQuery(
    ['meetingEvidence', userId, id, operationId, segmentId, revision],
    ({ signal }) => dataService.getMeetingEvidence(id, operationId!, segmentId!, revision!, signal),
    {
      enabled: !!userId && !!operationId && !!segmentId && !!revision,
      retry: false,
      refetchInterval: 3000,
    },
  );
}

export function useMeetingSpeech(userId: string | undefined, id: string, answerId: string) {
  return useQuery(
    [QueryKeys.meetingSpeech, userId, id, answerId],
    ({ signal }) => dataService.getMeetingSpeech(id, answerId, signal),
    {
      enabled: !!userId && !!id && !!answerId,
      retry: false,
      refetchInterval: (data) => (data?.speech?.state === 'processing' ? 2000 : false),
    },
  );
}
export function usePrepareMeetingSpeech(userId: string | undefined, id: string, answerId: string) {
  const cache = useQueryClient();
  return useMutation(dataService.prepareMeetingSpeech, {
    mutationKey: [MutationKeys.prepareMeetingSpeech, userId, id, answerId],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingSpeech, userId, id, answerId]),
  });
}
export function useMeetingPlayback(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.changeMeetingPlayback, {
    mutationKey: [MutationKeys.changeMeetingPlayback, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingTranscript, userId, id]),
  });
}
