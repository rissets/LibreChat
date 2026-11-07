import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { QueryKeys } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  QueryClient,
  InfiniteData,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type { TMeetingLifecycle, ConversationListResponse } from 'librechat-data-provider';
import { clearMeetingAttempts, setMeetingAttemptSession } from './attempts';
import { parseMeetingChatPath } from './path';

type Scope = { userId?: string; meetingId?: string; resource?: string };
type LossReason = 'access' | 'transport' | 'hidden' | 'lifecycle' | 'session';
export type LifecycleChange = {
  value: TMeetingLifecycle;
  removals: TMeetingLifecycle['removals'];
};
type Listener = Scope & { clear: (reason: LossReason, change?: LifecycleChange) => void };
type Pending = Scope & { controller: AbortController };
const clients = new Set<QueryClient>();
const listeners = new Set<Listener>();
const pending = new Set<Pending>();
const generations = new Map<string, number>();
const lifecycles = new Map<string, { generation: number; snapshot: string }>();
let session: string | undefined;
const scopeKey = (scope: Scope) =>
  (scope.userId ?? '') + ':' + (scope.meetingId ?? '') + ':' + (scope.resource ?? '');
const matches = (scope: Scope, target: Scope) =>
  (!target.userId || scope.userId === target.userId) &&
  (!target.meetingId || scope.meetingId === target.meetingId);
const matchesResource = (scope: Scope, target: Scope) =>
  matches(scope, target) ||
  (['meetings', 'meetingChats', 'meetingSharedArtifacts', 'createMeeting'].includes(
    scope.resource ?? '',
  ) &&
    (!target.userId || scope.userId === target.userId));
const nativeMeetingKey = (key: QueryKey, scope: Scope) => {
  if (key[0] !== QueryKeys.messages && key[0] !== QueryKeys.conversation) return false;
  const binding = parseMeetingChatPath(typeof key[1] === 'string' ? key[1] : '');
  return !!binding && (!scope.meetingId || binding.meetingId === scope.meetingId);
};
const meetingKey = (key: QueryKey | undefined, scope: Scope) =>
  key &&
  (nativeMeetingKey(key, scope) ||
    (typeof key[0] === 'string' &&
      /meeting/i.test(key[0]) &&
      key[0] !== 'meetingAccess' &&
      matchesResource(
        {
          userId: String(key[1] ?? ''),
          meetingId: key[2] ? String(key[2]) : undefined,
          resource: key[0],
        },
        scope,
      )));

function receiptChanged(error: unknown) {
  return (
    isAxiosError<{ code?: string }>(error) &&
    ['MEETING_DELIVERY_CHANGED', 'MEETING_LIFECYCLE_CHANGED', 'MEETING_DELIVERY_EXPIRED'].includes(
      error.response?.data?.code ?? '',
    )
  );
}

function lifecycleResource(resource: string, change?: LifecycleChange) {
  if (resource === 'meetingLifecycle' || resource === 'meetingAccess') return false;
  if (!change) return true;
  const classes = new Set<string>(change.removals.map((row) => row.artifact_class));
  for (const kind of ['meeting', 'transcript', 'results', 'answers'])
    if (change.value.classes[kind]?.available === false) classes.add(kind);
  if (classes.has('meeting') || classes.has('transcript')) return true;
  if (resource === 'meetingSharedArtifacts' && (classes.has('answers') || classes.has('results')))
    return true;
  if (
    classes.has('answers') &&
    /assistant|evidence|sharedAnswer|voice|speech|playback|chat|workspace/i.test(resource)
  )
    return true;
  if (
    classes.has('results') &&
    (/final|result/i.test(resource) || resource === 'meetingSharedEvidence')
  )
    return true;
  if ((classes.has('speech') || classes.has('answers')) && /speech|playback/i.test(resource))
    return true;
  return classes.has('processing_audio') && /submitMeeting(Audio|Voice)/.test(resource);
}

/** Observe server policy/tombstones through the existing delivery and cache boundary. */
export function observeMeetingLifecycle(
  userId: string | undefined,
  meetingId: string,
  value: TMeetingLifecycle,
) {
  const key = scopeKey({ userId, meetingId });
  const previous = lifecycles.get(key);
  const snapshot = JSON.stringify([value.generation, value.policy, value.classes]);
  lifecycles.set(key, { generation: value.generation, snapshot });
  if (!previous) {
    /** A load starts with no baseline: the session transition already erased cached
     *  meeting data, so treating the first snapshot as a change would abort the reads
     *  this page just started (blank chat after a refresh). */
    return;
  }
  if (previous.snapshot === snapshot) return;
  const removals = value.removals.filter((row) => row.generation > previous.generation);
  if (removals.length || Object.values(value.classes).some((kind) => !kind.available))
    invalidateMeetingAccess(userId, meetingId, 'lifecycle', { value, removals });
}

/** Synchronous local erasure precedes any asynchronous query cancellation or lease release. */
export function invalidateMeetingAccess(
  userId?: string,
  meetingId?: string,
  reason: LossReason = 'access',
  change?: LifecycleChange,
) {
  const target = { userId, meetingId };
  const resourceSelected = (resource: string) =>
    !(reason === 'transport' && ['createMeeting', 'meetingLifecycle'].includes(resource)) &&
    (reason !== 'lifecycle' || lifecycleResource(resource, change));
  if ((reason === 'access' || reason === 'lifecycle') && resourceSelected('meetingChat'))
    clearMeetingAttempts(target);
  if (reason !== 'hidden') {
    for (const key of generations.keys()) {
      const [owner, meeting, resource] = key.split(':');
      if (
        matchesResource({ userId: owner, meetingId: meeting || undefined, resource }, target) &&
        resourceSelected(resource)
      )
        generations.set(key, (generations.get(key) ?? 0) + 1);
    }
  }
  for (const listener of [...listeners])
    if (matches(listener, target)) listener.clear(reason, change);
  if (reason !== 'hidden') {
    for (const request of pending)
      if (matchesResource(request, target) && resourceSelected(request.resource ?? ''))
        request.controller.abort();
  }
  for (const client of clients) {
    // Ordinary history carries only meeting titles; remove affected projections synchronously.
    const historyKeys = [QueryKeys.allConversations, QueryKeys.archivedConversations];
    for (const historyKey of historyKeys) {
      if (reason === 'hidden' || !resourceSelected('meetingChat')) continue;
      void client.cancelQueries([historyKey]);
      client.setQueriesData<InfiniteData<ConversationListResponse>>([historyKey], (data) => {
        if (!data?.pages) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            conversations: page.conversations.filter((conversation) => {
              const binding = parseMeetingChatPath(conversation.conversationId ?? '');
              return !binding || (!!meetingId && binding.meetingId !== meetingId);
            }),
          })),
        };
      });
    }
    const selected = (key: QueryKey) =>
      !!meetingKey(key, target) &&
      (nativeMeetingKey(key, target)
        ? reason !== 'hidden' && resourceSelected('meetingChat')
        : resourceSelected(String(key[0]))) &&
      (!['transport', 'hidden'].includes(reason) ||
        ![
          'meeting',
          'meetings',
          'meetingShares',
          'meetingRecipients',
          ...(reason === 'hidden' ? ['meetingWorkspace', 'meetingTranscript'] : []),
        ].includes(String(key[0])));
    void client.cancelQueries({ predicate: (query) => selected(query.queryKey) });
    client.removeQueries({ predicate: (query) => selected(query.queryKey) });
    if (reason === 'hidden') {
      void client.invalidateQueries({ predicate: (query) => !!meetingKey(query.queryKey, target) });
    }
    for (const mutation of client.getMutationCache().getAll())
      if (
        reason !== 'hidden' &&
        meetingKey(mutation.options.mutationKey, target) &&
        resourceSelected(String(mutation.options.mutationKey?.[0]))
      )
        client.getMutationCache().remove(mutation);
  }
}

export function subscribeMeetingAccessLoss(scope: Scope, clear: Listener['clear']) {
  const listener = { ...scope, clear };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Account/session transitions invalidate in-flight generations, including same-account relogin. */
export function setMeetingSession(userId?: string, token?: string) {
  let sid = '';
  try {
    const payload = JSON.parse(
      atob((token?.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/')),
    ) as { identitySessionId?: string };
    sid = payload.identitySessionId ?? '';
  } catch {
    /* Missing session is never used as server authority. */
  }
  const next = userId ? userId + ':' + sid : undefined;
  setMeetingAttemptSession(next);
  /** Only an established session transitioning to another (or logging out) invalidates
   *  meeting access. On initial mount / page refresh, session starts undefined; wiping
   *  the state then would abort the in-flight queries and clear the active conversation. */
  if (session !== undefined && session !== next) invalidateMeetingAccess(undefined, undefined, 'session');
  if (session !== undefined && session !== next) lifecycles.clear();
  session = next;
}

async function guarded<T>(
  scope: Scope,
  signal: AbortSignal | undefined,
  call: (signal: AbortSignal) => Promise<T>,
  refreshRead = false,
) {
  const key = scopeKey(scope);
  const generation = generations.get(key) ?? 0;
  generations.set(key, generation);
  const request = { ...scope, controller: new AbortController() };
  pending.add(request);
  const combined = signal
    ? AbortSignal.any([signal, request.controller.signal])
    : request.controller.signal;
  try {
    let value: T;
    try {
      value = await call(combined);
    } catch (error) {
      // The rejected projection has not reached cache or callbacks. Obtain one
      // current authorized read before classifying receipt drift as access loss.
      // Mutations never enter this path: an accepted operation is not replayed.
      if (!refreshRead || !receiptChanged(error) || combined.aborted)
        throw error;
      value = await call(combined);
    }
    if (combined.aborted || generations.get(key) !== generation)
      throw new DOMException('Access changed', 'AbortError');
    return value;
  } catch (error) {
    if (isAxiosError<{ code?: string }>(error)) {
      const code = error.response?.data?.code;
      if (
        code === 'MEETING_SOURCE_UNAVAILABLE' ||
        code === 'MEETING_LIFECYCLE_CHANGED' ||
        receiptChanged(error)
      ) {
        // A class may expire independently. Clear body authority now; the separately
        // authorized lifecycle projection identifies which controls remain available.
        invalidateMeetingAccess(scope.userId, scope.meetingId, 'transport');
        throw error;
      }
      if (
        ([401, 403].includes(error.response?.status ?? 0) &&
          /** The LibreChat meeting gateway refuses native reads (subagents, tool calls,
           *  share links) on a meeting conversation; that is not a Control Panel
           *  access change, so tearing down the meeting data would only cause a refetch
           *  loop and empty panels. */
          code !== 'MEETING_DELIVERY_EXPIRED' &&
          code !== 'MEETING_DELIVERY_CHANGED' &&
          code !== 'MEETING_CHAT_OPERATION_DENIED') ||
        (code &&
          [
            'MEETING_ARTIFACT_NOT_FOUND',
            'MEETING_ANSWER_NOT_FOUND',
            'MEETING_SPEECH_NOT_FOUND',
          ].includes(code))
      )
        invalidateMeetingAccess(scope.userId, scope.meetingId);
    }
    throw error;
  } finally {
    pending.delete(request);
  }
}

export function useMeetingQuery<T>(
  key: QueryKey,
  fn: (context: { signal?: AbortSignal }) => Promise<T>,
  options: Omit<UseQueryOptions<T, unknown, T, QueryKey>, 'queryKey' | 'queryFn'> = {},
) {
  const client = useQueryClient();
  clients.add(client);
  const scope = {
    userId: key[1] ? String(key[1]) : undefined,
    meetingId: key[2] ? String(key[2]) : undefined,
    resource: String(key[0]),
  };
  return useQuery<T, unknown, T, QueryKey>(
    key,
    async ({ signal }) => guarded(scope, signal, (fresh) => fn({ signal: fresh }), true),
    { refetchInterval: false, ...options },
  );
}

export function useMeetingMutation<T, V>(
  fn: (variables: V, signal?: AbortSignal) => Promise<T>,
  options: Omit<UseMutationOptions<T, unknown, V>, 'mutationFn'>,
) {
  const client = useQueryClient();
  clients.add(client);
  const key = options.mutationKey ?? [];
  const scope = {
    userId: key[1] ? String(key[1]) : undefined,
    meetingId: key[2] ? String(key[2]) : undefined,
    resource: String(key[0]),
  };
  const stamps = useRef(new Map<T, number>());
  const result = useMutation<T, unknown, V>(
    async (variables) => {
      const generation = generations.get(scopeKey(scope)) ?? 0;
      const value = await guarded(scope, undefined, (signal) => fn(variables, signal));
      if (generation !== generations.get(scopeKey(scope)))
        throw new DOMException('Access changed', 'AbortError');
      stamps.current.set(value, generation);
      return value;
    },
    {
      cacheTime: 0,
      ...options,
      onSuccess: async (data, variables, context) => {
        if (stamps.current.get(data) !== generations.get(scopeKey(scope)))
          throw new DOMException('Access changed', 'AbortError');
        await options.onSuccess?.(data, variables, context);
      },
      onSettled: async (data, error, variables, context) => {
        try {
          if (data === undefined || stamps.current.get(data) === generations.get(scopeKey(scope)))
            await options.onSettled?.(data, error, variables, context);
        } finally {
          if (data !== undefined) stamps.current.delete(data);
        }
      },
    },
  );
  const reset = useRef(result.reset);
  reset.current = result.reset;
  useEffect(
    () =>
      subscribeMeetingAccessLoss(
        { userId: scope.userId, meetingId: scope.meetingId },
        (reason, change) => {
          if (reason === 'hidden') return;
          if (reason === 'transport' && scope.resource === 'createMeeting') return;
          if (reason === 'lifecycle' && !lifecycleResource(scope.resource, change)) return;
          stamps.current.clear();
          reset.current();
        },
      ),
    [scope.userId, scope.meetingId, scope.resource],
  );
  return result;
}

export function useMeetingBoundary(userId?: string, meetingId?: string) {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    setLost(false);
    return subscribeMeetingAccessLoss({ userId, meetingId }, (reason) => {
      if (reason !== 'transport' && reason !== 'lifecycle' && reason !== 'hidden') setLost(true);
    });
  }, [userId, meetingId]);
  useEffect(() => {
    const restore = () => {
      if (document.visibilityState === 'hidden') return;
      // Reauthorize body data while retaining content-free retry identities in this tab.
      invalidateMeetingAccess(userId, meetingId, 'hidden');
      setLost(false);
    };
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('pageshow', restore);
    };
  }, [userId, meetingId]);
  return { lost, retry: () => setLost(false) };
}
