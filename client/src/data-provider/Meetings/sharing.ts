import { useQueryClient } from '@tanstack/react-query';
import { dataService, MutationKeys, QueryKeys } from 'librechat-data-provider';
import { useMeetingMutation as useMutation, useMeetingQuery as useQuery } from './access';

export function useMeetingRecipients(userId: string | undefined, id: string, query: string) {
  return useQuery(
    [QueryKeys.meetingRecipients, userId, id, query],
    ({ signal }) => dataService.getMeetingRecipients(id, query, signal),
    {
      enabled: !!userId && query.trim().length > 0,
      retry: false,
    },
  );
}
export function useMeetingShares(userId: string | undefined, id: string) {
  return useQuery(
    [QueryKeys.meetingShares, userId, id],
    ({ signal }) => dataService.getMeetingShares(id, signal),
    {
      enabled: !!userId,
      retry: false,
    },
  );
}
export function useShareMeeting(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.shareMeeting, {
    mutationKey: [MutationKeys.shareMeeting, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingShares, userId, id]),
  });
}
export function useRevokeMeetingShare(userId: string | undefined, id: string) {
  const cache = useQueryClient();
  return useMutation(dataService.revokeMeetingShare, {
    mutationKey: [MutationKeys.revokeMeetingShare, userId, id],
    retry: false,
    onSuccess: () => cache.invalidateQueries([QueryKeys.meetingShares, userId, id]),
  });
}
export function useSharedMeetingArtifacts(userId?: string, enabled = false) {
  return useQuery(
    [QueryKeys.meetingSharedArtifacts, userId],
    ({ signal }) => dataService.getMeetingSharedArtifacts(signal),
    {
      enabled: !!userId && enabled,
      retry: false,
    },
  );
}
export function useSharedMeetingResult(userId: string | undefined, id: string, version: number) {
  return useQuery(
    [QueryKeys.meetingSharedResult, userId, id, version],
    ({ signal }) => dataService.getMeetingSharedResult(id, version, signal),
    {
      enabled: !!userId,
      retry: false,
      staleTime: 0,
      refetchInterval: 3000,
    },
  );
}
export function useSharedMeetingEvidence(
  userId: string | undefined,
  id: string,
  version: number,
  segmentId?: string,
  revision?: number,
) {
  return useQuery(
    [QueryKeys.meetingSharedEvidence, userId, id, version, segmentId, revision],
    ({ signal }) =>
      dataService.getMeetingSharedEvidence(id, version, segmentId!, revision!, signal),
    {
      enabled: !!userId && !!segmentId && !!revision,
      retry: false,
      staleTime: 0,
      refetchInterval: 3000,
    },
  );
}
export function useSharedMeetingAnswer(userId: string | undefined, id: string, answerId: string) {
  return useQuery(
    [QueryKeys.meetingSharedAnswer, userId, id, answerId],
    ({ signal }) => dataService.getMeetingSharedAnswer(id, answerId, signal),
    { enabled: !!userId, retry: false, staleTime: 0, refetchInterval: 3000 },
  );
}
export function useSharedMeetingAnswerEvidence(
  userId: string | undefined,
  id: string,
  answerId: string,
  segmentId?: string,
  revision?: number,
) {
  return useQuery(
    [QueryKeys.meetingSharedEvidence, userId, id, answerId, segmentId, revision],
    ({ signal }) =>
      dataService.getMeetingSharedAnswerEvidence(id, answerId, segmentId!, revision!, signal),
    { enabled: !!userId && !!segmentId && !!revision, retry: false, refetchInterval: 3000 },
  );
}
