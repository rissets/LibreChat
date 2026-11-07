import { useCallback, useEffect, useRef, useState } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import type { TAskFunction } from '~/common';
import {
  subscribeMeetingAccessLoss,
  invalidateMeetingAccess,
} from '~/data-provider/Meetings/access';
import { useOptionalMeetingRuntime } from '~/components/Meetings/runtime-context';
import { parseMeetingChatPath } from '~/data-provider/Meetings/workspace';
import { useMeeting, useMeetingLifecycle } from '~/data-provider/Meetings';
import { meetingMessageContext } from '~/components/Meetings/metadata';
import { useMeetingNotes } from '~/components/Meetings/NotesState';

/** A native chat pane flushes dirty notes and enforces CP meeting access before delegating turns. */
export default function useMeetingConversation({
  conversationId,
  userId,
  onSubmit,
  stopGenerating,
  onAccepted,
  onUnavailable,
}: {
  conversationId?: string;
  userId?: string;
  onSubmit?: TAskFunction;
  stopGenerating?: () => Promise<void> | void;
  onAccepted?: (text: string) => void;
  onUnavailable?: () => void;
}) {
  const binding = parseMeetingChatPath(conversationId);
  const isMeeting = !!binding;
  const meetingId = binding?.meetingId ?? '';
  const cache = useQueryClient();
  const runtime = useOptionalMeetingRuntime();
  const attach = runtime?.attach;
  const notes = useMeetingNotes(meetingId);
  const [denied, setDenied] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const stopGeneratingRef = useRef(stopGenerating);
  stopGeneratingRef.current = stopGenerating;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  const active = useRef(conversationId);
  active.current = conversationId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const epoch = useRef(0);
  const inFlight = useRef(new Set<string>());
  const meeting = useMeeting(userId, meetingId, isMeeting && denied !== conversationId);
  const lifecycle = useMeetingLifecycle(userId, meetingId, isMeeting && denied !== conversationId);
  const unavailable =
    (isMeeting && denied === conversationId) ||
    (isMeeting && meeting.isError) ||
    lifecycle.data?.classes.answers?.available === false;
  const ready =
    isMeeting && !!(meeting.data || runtime?.session?.id === meetingId) && !unavailable;

  useEffect(() => {
    if (meeting.data && !unavailable) attach?.(meeting.data);
  }, [meeting.data, unavailable, attach]);

  useEffect(() => {
    if (!isMeeting || !conversationId) return;
    return subscribeMeetingAccessLoss({ userId, meetingId }, (reason, change) => {
      if (reason === 'hidden' || reason === 'transport') {
        void cache.invalidateQueries([QueryKeys.messages, conversationId]);
        return;
      }
      if (
        reason === 'lifecycle' &&
        change &&
        !['meeting', 'transcript', 'answers'].some(
          (kind) =>
            change.value.classes[kind]?.available === false ||
            change.removals.some((row) => row.artifact_class === kind),
        )
      )
        return;
      epoch.current++;
      setDenied(conversationId);
      void stopGeneratingRef.current?.();
      unavailableRef.current?.();
      void cache.cancelQueries([QueryKeys.messages, conversationId]);
      cache.removeQueries([QueryKeys.messages, conversationId]);
      cache.removeQueries([QueryKeys.conversation, conversationId]);
    });
  }, [userId, meetingId, conversationId, cache, isMeeting]);

  useEffect(() => {
    if (isMeeting && meeting.isError && denied !== conversationId)
      invalidateMeetingAccess(userId, meetingId, 'transport');
  }, [isMeeting, meeting.isError, denied, conversationId, userId, meetingId]);

  useEffect(() => {
    if (!isMeeting) return;
    const restore = () => {
      if (document.visibilityState !== 'hidden') setDenied(null);
    };
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('pageshow', restore);
    return () => {
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('pageshow', restore);
    };
  }, [isMeeting]);

  const ask: TAskFunction = useCallback(
    (props, options = {}) => {
      const text = props.text.trim();
      const projected = cache.getQueryData<TMessage[]>([QueryKeys.messages, conversationId]);
      const pending = projected?.some((message) =>
        ['accepted', 'processing'].includes(meetingMessageContext(message)?.state ?? ''),
      );
      if (
        !ready ||
        pending ||
        !conversationId ||
        !userId ||
        (!text && !options.overrideFiles?.length) ||
        inFlight.current.has(conversationId) ||
        options.isRegenerate ||
        options.isContinued ||
        options.isEdited ||
        options.compact ||
        options.addedConvo ||
        (props.conversationId != null && props.conversationId !== conversationId) ||
        props.overrideConvoId != null
      )
        return false;
      const submitTurn = onSubmitRef.current;
      if (!submitTurn) return false;
      const id = conversationId;
      const needsFlush =
        notes != null && (notes.dirty || notes.saving || notes.failed || notes.conflict);
      if (!needsFlush) {
        if (submitTurn(props, options) === false) return false;
        setFailed(null);
        if (mounted.current && active.current === id) {
          onAccepted?.(text);
        }
        return;
      }
      const generation = epoch.current;
      inFlight.current.add(id);
      setSending(id);
      setFailed(null);
      void (async () => {
        try {
          // Notes remain shell-owned. A failed autosave keeps the composer's draft intact.
          if (!(await notes.flush())) throw new Error('Notes not saved');
          if (generation !== epoch.current) return;
          if ((onSubmitRef.current ?? submitTurn)(props, options) === false)
            throw new Error('Turn rejected');
          if (mounted.current && active.current === id) {
            onAccepted?.(text);
          }
        } catch {
          if (generation === epoch.current) setFailed(id);
        } finally {
          inFlight.current.delete(id);
          setSending((current) => (current === id ? null : current));
        }
      })();
    },
    [ready, conversationId, notes, onAccepted, cache, userId],
  );

  const revoke = useCallback(() => {
    if (isMeeting) invalidateMeetingAccess(userId, meetingId, 'transport');
  }, [isMeeting, userId, meetingId]);

  const retry = useCallback(() => {
    setDenied(null);
    setFailed(null);
    void meeting.refetch();
    void lifecycle.refetch();
    void cache.invalidateQueries([QueryKeys.messages, conversationId]);
  }, [meeting, lifecycle, cache, conversationId]);
  return {
    isMeeting,
    ask,
    ready,
    unavailable,
    retry,
    revoke,
    isSubmitting: isMeeting && sending === conversationId,
    failed: isMeeting && failed === conversationId,
  };
}
