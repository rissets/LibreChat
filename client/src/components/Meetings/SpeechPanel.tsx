import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, Spinner } from '@librechat/client';
import {
  useMeetingPlayback,
  useMeetingSpeech,
  useMeetingTranscript,
  usePrepareMeetingSpeech,
} from '~/data-provider/Meetings';
import { subscribeMeetingAccessLoss } from '~/data-provider/Meetings/access';
import { meetingLimitError } from './limit-errors';
import { useMeetingAudioSession } from './audio';
import SharingPanel from './SharingPanel';
import { useLocalize } from '~/hooks';

type PlaybackState = 'idle' | 'starting' | 'playing' | 'stopped' | 'ended' | 'failed';
type EndReason = 'stopped' | 'ended' | 'failed' | 'left' | 'access';

/** Uses only explicitly delivered internal bytes, never browser speech synthesis or autoplay. */
export function SpeechPanel({
  meetingId,
  answerId,
  answerText,
  captureActive = false,
  userId,
  readOnly = false,
  hideSharing = false,
}: {
  meetingId: string;
  answerId: string;
  answerText: string;
  captureActive?: boolean;
  userId?: string;
  readOnly?: boolean;
  hideSharing?: boolean;
}) {
  const localize = useLocalize();
  const {
    owner: audioOwner,
    claim: claimAudio,
    release: releaseAudio,
    onStop,
  } = useMeetingAudioSession();
  const audioToken = useRef<string | null>(null);
  const status = useMeetingSpeech(userId, meetingId, answerId);
  const prepare = usePrepareMeetingSpeech(userId, meetingId, answerId);
  const transcript = useMeetingTranscript(readOnly ? undefined : userId, meetingId);
  const { mutateAsync: changePlayback } = useMeetingPlayback(userId, meetingId);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [state, setState] = useState<PlaybackState>('idle');
  const audio = useRef<HTMLAudioElement>(null);
  const lease = useRef<{ id: string; speechId: string; deadline: number } | null>(null);
  const objectURL = useRef<string | null>(null);
  const generation = useRef(0);
  const released = useRef<Promise<unknown>>(Promise.resolve());
  const active = state === 'starting' || state === 'playing';
  const capturing = captureActive || transcript.data?.capture?.state === 'capturing';
  const speech = !status.isError ? status.data?.speech : undefined;
  const currentSpeech = useRef(speech);
  currentSpeech.current = speech;
  let preparationError = localize('com_meeting_speech_delivery');
  if (meetingLimitError(prepare.error) === 'concurrency')
    preparationError = localize('com_meeting_concurrency_full');
  if (isAxiosError(prepare.error) && [401, 403].includes(prepare.error.response?.status ?? 0))
    preparationError = localize('com_meeting_denied');
  const preparationLabel = prepare.isLoading
    ? 'com_meeting_speech_preparing'
    : 'com_meeting_speech_prepare';
  const speechMessages = {
    processing: 'com_meeting_speech_preparing',
    rejected: 'com_meeting_speech_failed',
    uncertain: 'com_meeting_speech_failed',
    expired: 'com_meeting_speech_expired',
  } as const;
  const cueEnd = new Date((speech?.provenance.duration_seconds ?? 600) * 1000)
    .toISOString()
    .slice(11, 23);
  const captionText = answerText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const captions =
    'data:text/vtt;charset=utf-8,' +
    encodeURIComponent('WEBVTT\n\n00:00:00.000 --> ' + cueEnd + '\n' + captionText + '\n');

  const releaseLocal = useCallback(() => {
    generation.current++;
    const current = lease.current;
    lease.current = null;
    // Silence is synchronous and precedes lease release or any network operation.
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current.load();
      for (const track of audio.current.querySelectorAll('track')) track.removeAttribute('src');
    }
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = null;
    releaseAudio(audioToken.current);
    audioToken.current = null;
    return current;
  }, [releaseAudio]);
  useEffect(
    () =>
      subscribeMeetingAccessLoss({ userId, meetingId }, (reason, change) => {
        if (reason === 'lifecycle' && change && change.value.classes.answers?.available !== false) {
          const removed = change.removals.some(
            (row) =>
              row.artifact_class === 'speech' &&
              (row.artifact_id === currentSpeech.current?.id ||
                row.artifact_id === '*' ||
                row.through_at),
          );
          if (!removed) return;
        }
        releaseLocal();
        setDelivery(null);
        setState('failed');
      }),
    [meetingId, releaseLocal, userId],
  );
  const stop = useCallback(
    (reason: EndReason = 'stopped') => {
      const current = releaseLocal();
      let next: PlaybackState = 'stopped';
      if (reason === 'ended') next = 'ended';
      if (reason === 'failed' || reason === 'access') next = 'failed';
      setState(next);
      if (current)
        released.current = changePlayback({
          id: meetingId,
          speechId: current.speechId,
          action: 'stop',
          playback_id: current.id,
          reason,
        }).catch(() => undefined);
    },
    [changePlayback, meetingId, releaseLocal],
  );

  useEffect(() => {
    let pending = false;
    let tick = 0;
    const timer = window.setInterval(() => {
      const current = lease.current;
      if (!current) return;
      if (performance.now() >= current.deadline - 1000) {
        stop('access');
        return;
      }
      tick++;
      if (pending || tick % 3 !== 0) return;
      pending = true;
      const began = performance.now();
      void changePlayback({
        id: meetingId,
        speechId: current.speechId,
        action: 'heartbeat',
        playback_id: current.id,
      })
        .then((value) => {
          if (
            lease.current?.id === current.id &&
            value.playback &&
            ['preparing', 'playing'].includes(value.playback.state)
          )
            current.deadline =
              performance.now() + value.playback.lease_remaining_ms - (performance.now() - began);
          else if (lease.current?.id === current.id) stop('access');
        })
        .catch(() => {
          if (lease.current?.id === current.id) stop('access');
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    const leave = () => stop('left');
    const hidden = () => {
      if (document.visibilityState === 'hidden') stop('left');
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
      const current = releaseLocal();
      if (current)
        void changePlayback({
          id: meetingId,
          speechId: current.speechId,
          action: 'stop',
          playback_id: current.id,
          reason: 'left',
        }).catch(() => undefined);
    };
  }, [changePlayback, meetingId, releaseLocal, stop]);

  useEffect(() => {
    if (active && (status.isError || capturing || speech?.state !== 'ready')) stop('access');
  }, [active, capturing, status.isError, speech?.state, stop]);
  useEffect(() => {
    if (!active || !speech?.expires_at) return;
    const expiry = window.setTimeout(
      () => stop('access'),
      Math.max(0, Date.parse(speech.expires_at) - Date.now()),
    );
    return () => window.clearTimeout(expiry);
  }, [active, speech?.expires_at, stop]);
  useEffect(
    () =>
      onStop(() => {
        if (!audioToken.current && !lease.current) return Promise.resolve();
        stop();
        return released.current;
      }),
    [onStop, stop],
  );

  const synthesize = () => {
    const operation = delivery ?? crypto.randomUUID();
    setDelivery(operation);
    prepare.mutate(
      { id: meetingId, answerId, operation_id: operation },
      { onSuccess: () => setDelivery(null) },
    );
  };
  const play = async () => {
    if (!speech || active || lease.current || capturing || audioOwner !== null) return;
    audioToken.current = claimAudio('playback');
    if (!audioToken.current) return;
    const playbackId = crypto.randomUUID();
    const attempt = generation.current;
    setState('starting');
    try {
      await released.current;
      if (attempt !== generation.current) return;
      const began = performance.now();
      const value = await changePlayback({
        id: meetingId,
        speechId: speech.id,
        action: 'start',
        playback_id: playbackId,
      });
      if (attempt !== generation.current) {
        void changePlayback({
          id: meetingId,
          speechId: speech.id,
          action: 'stop',
          playback_id: playbackId,
          reason: 'stopped',
        }).catch(() => undefined);
        return;
      }
      if (!value.playback || !value.audio_base64 || value.mime_type !== 'audio/wav')
        throw new Error('MEETING_AUDIO_UNAVAILABLE');
      lease.current = {
        id: playbackId,
        speechId: speech.id,
        deadline:
          performance.now() + value.playback.lease_remaining_ms - (performance.now() - began),
      };
      if (lease.current.deadline - performance.now() < 1000)
        throw new Error('MEETING_PLAYBACK_EXPIRED');
      // Bytes can spend time in transport buffers. Reauthorize the viewer/session and exact
      // dependencies after receipt, before creating any local media source.
      const renewedAt = performance.now();
      const renewed = await changePlayback({
        id: meetingId,
        speechId: speech.id,
        action: 'heartbeat',
        playback_id: playbackId,
      });
      if (attempt !== generation.current || lease.current?.id !== playbackId) return;
      if (!renewed.playback || !['preparing', 'playing'].includes(renewed.playback.state))
        throw new Error('MEETING_PLAYBACK_EXPIRED');
      lease.current.deadline =
        performance.now() + renewed.playback.lease_remaining_ms - (performance.now() - renewedAt);
      if (lease.current.deadline - performance.now() < 1000)
        throw new Error('MEETING_PLAYBACK_EXPIRED');
      const raw = Uint8Array.from(atob(value.audio_base64), (character) => character.charCodeAt(0));
      objectURL.current = URL.createObjectURL(new Blob([raw], { type: value.mime_type }));
      if (!audio.current) throw new Error('MEETING_AUDIO_UNAVAILABLE');
      audio.current.src = objectURL.current;
      await audio.current.play();
    } catch {
      if (attempt === generation.current) stop('failed');
    }
  };
  const labels = {
    idle: 'com_meeting_speech_ready',
    starting: 'com_meeting_playback_starting',
    playing: 'com_meeting_playback_active',
    stopped: 'com_meeting_playback_stopped',
    ended: 'com_meeting_playback_ended',
    failed: 'com_meeting_playback_failed',
  } as const;
  return (
    <section
      aria-label={localize('com_meeting_speech')}
      className="border-border-light flex flex-col gap-3 border-t pt-3"
    >
      <h5 className="font-semibold">{localize('com_meeting_speech')}</h5>
      <p className="text-text-secondary">{localize('com_meeting_speech_capture_policy')}</p>
      <audio
        ref={audio}
        preload="none"
        aria-label={localize('com_meeting_speech_audio')}
        onPlaying={() => {
          const current = lease.current;
          if (!current) {
            audio.current?.pause();
            return;
          }
          setState('playing');
          void changePlayback({
            id: meetingId,
            speechId: current.speechId,
            action: 'playing',
            playback_id: current.id,
          }).catch(() => {
            if (lease.current?.id === current.id) stop('access');
          });
        }}
        onEnded={() => stop('ended')}
        onError={() => {
          if (lease.current) stop('failed');
        }}
      >
        <track
          kind="captions"
          src={captions}
          srcLang="id"
          label={localize('com_meeting_speech_caption')}
          default
        />
      </audio>
      {status.isLoading && <p role="status">{localize('com_ui_loading')}</p>}
      {status.isError && <p role="alert">{localize('com_meeting_speech_unavailable')}</p>}
      {!readOnly && !speech && !status.isLoading && !status.isError && (
        <Button
          variant="outline"
          className="self-start"
          disabled={prepare.isLoading}
          onClick={synthesize}
        >
          {localize(
            delivery && !prepare.isLoading ? 'com_meeting_delivery_retry' : preparationLabel,
          )}
        </Button>
      )}
      {prepare.isLoading && (
        <p role="status" className="flex items-center gap-2">
          <Spinner className="size-4" />
          {localize('com_meeting_speech_preparing')}
        </p>
      )}
      {prepare.isError && <p role="alert">{preparationError}</p>}
      {speech?.state === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void play()}
              disabled={
                active || capturing || audioOwner !== null || (!readOnly && transcript.isError)
              }
            >
              {localize('com_meeting_speech_play')}
            </Button>
            <Button variant="outline" onClick={() => stop()} disabled={!active}>
              {localize('com_meeting_speech_stop')}
            </Button>
          </div>
          <p role={state === 'failed' ? 'alert' : 'status'} aria-live="polite">
            {localize(labels[state])}
          </p>
          {capturing && <p role="status">{localize('com_meeting_speech_pause_first')}</p>}
          <details className="text-text-secondary text-sm">
            <summary>{localize('com_meeting_speech_details')}</summary>
            <p className="break-words">
              {localize('com_meeting_speech_model')}: {speech.provenance.model_version} ·{' '}
              {speech.provenance.adapter_version}
            </p>
            <p>
              {localize('com_meeting_speech_synthesis_ms', {
                0: speech.provenance.synthesis_ms ?? 0,
              })}
            </p>
          </details>
          {!readOnly && !hideSharing && (
            <SharingPanel
              meetingId={meetingId}
              userId={userId}
              version={1}
              artifact={{ kind: 'speech', id: speech.id }}
            />
          )}
        </>
      )}
      {speech && speech.state !== 'ready' && (
        <p role="status">{localize(speechMessages[speech.state])}</p>
      )}
      <p className="text-text-secondary text-sm">{localize('com_meeting_speech_temporary')}</p>
    </section>
  );
}
