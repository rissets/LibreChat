import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import type { MeetingMicrophone } from './capture';
import { useMeetingTranscript } from '~/data-provider/Meetings';
import { useMeetingAudioSession } from './audio';
import { useMeetingNotes } from './NotesState';
import { useVoiceQuestion } from './voice';
import { useLocalize } from '~/hooks';

export function VoicePanel({
  meetingId,
  userId,
  microphone,
  compact = false,
}: {
  meetingId: string;
  userId?: string;
  microphone: MeetingMicrophone;
  compact?: boolean;
}) {
  const localize = useLocalize();
  const notes = useMeetingNotes(meetingId);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesFailed, setNotesFailed] = useState(false);
  const starting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const voice = useVoiceQuestion(userId, meetingId, microphone);
  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setSavingNotes(true);
    setNotesFailed(false);
    try {
      if (notes && !(await notes.flush())) {
        if (mounted.current) setNotesFailed(true);
        return;
      }
      if (mounted.current) await voice.start();
    } finally {
      starting.current = false;
      if (mounted.current) setSavingNotes(false);
    }
  };
  const audio = useMeetingAudioSession();
  const transcript = useMeetingTranscript(userId, meetingId);
  const playbackActive =
    audio.owner === 'playback' ||
    transcript.data?.playbacks.some(
      (value) => ['preparing', 'playing'].includes(value.state) && value.lease_remaining_ms > 0,
    );
  const opening = ['preparing', 'requesting'].includes(voice.state);
  const recording = voice.state === 'recording';
  const processing = ['sending', 'processing'].includes(voice.state);
  const remoteActive = voice.history.data?.questions.find((question) =>
    ['recording', 'accepted', 'processing', 'transcribed', 'answering'].includes(question.state),
  );
  const blocked =
    !!remoteActive ||
    playbackActive ||
    ['requesting', 'checking', 'stopping', 'recoverable'].includes(microphone.state) ||
    (audio.owner !== null && audio.owner !== 'participant');
  const messages = {
    idle: 'com_meeting_voice_idle',
    preparing: 'com_meeting_voice_preparing',
    requesting: 'com_meeting_capture_requesting',
    recording: 'com_meeting_voice_recording',
    sending: 'com_meeting_voice_processing',
    processing: 'com_meeting_voice_processing',
    cancelled: 'com_meeting_voice_cancelled',
    failed: 'com_meeting_voice_failed_status',
  } as const;
  const errors = {
    permission: 'com_meeting_mic_permission',
    device: 'com_meeting_mic_device',
    unsupported: 'com_meeting_mic_unsupported',
    service: 'com_meeting_voice_failed',
    delivery: 'com_meeting_voice_delivery',
  } as const;
  return (
    <section
      aria-label={localize('com_meeting_voice')}
      className={
        compact
          ? 'flex flex-col gap-3 py-3'
          : 'border-border-light flex flex-col gap-3 rounded-lg border p-3'
      }
    >
      {!compact && <h4 className="font-semibold">{localize('com_meeting_voice')}</h4>}
      {!compact && <p className="text-text-secondary">{localize('com_meeting_voice_scope')}</p>}
      {playbackActive && <p role="status">{localize('com_meeting_voice_stop_playback')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void start()}
          disabled={
            savingNotes || opening || recording || processing || blocked || !voice.supported
          }
        >
          {localize(
            microphone.state === 'capturing'
              ? 'com_meeting_voice_pause_ask'
              : 'com_meeting_voice_start',
          )}
        </Button>
        {(opening || recording) && (
          <Button variant="outline" onClick={() => voice.cancel()}>
            {localize('com_meeting_voice_cancel')}
          </Button>
        )}
        {recording && (
          <Button onClick={() => void voice.send()}>{localize('com_meeting_voice_send')}</Button>
        )}
      </div>
      <p
        role={voice.state === 'failed' ? 'alert' : 'status'}
        aria-live="polite"
        className="flex items-center gap-2"
      >
        {(opening || processing) && <Spinner className="size-4" />}
        {localize(messages[voice.state], { 0: voice.maximum })}
      </p>
      {recording && (
        <>
          <label htmlFor="meeting-voice-level">{localize('com_meeting_input_level')}</label>
          <meter id="meeting-voice-level" min={0} max={1} value={voice.level} className="w-full" />
        </>
      )}
      {voice.error && <p role="alert">{localize(errors[voice.error])}</p>}
      {notesFailed && <p role="alert">{localize('com_meeting_review_voice_save_failed')}</p>}
      {voice.saved?.state === 'uncertain' && (
        <p role="alert">{localize('com_meeting_voice_uncertain')}</p>
      )}
      {(voice.saved?.receipt_state === 'uncertain' ||
        voice.saved?.assistant_receipt_state === 'uncertain') && (
        <p role="alert">{localize('com_meeting_voice_reconciliation')}</p>
      )}
      {voice.canRetry && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void voice.retry()}
          disabled={processing}
        >
          {localize('com_meeting_voice_retry')}
        </Button>
      )}
      {remoteActive?.state === 'recording' &&
        !opening &&
        !recording &&
        !processing &&
        !voice.canRetry && (
          <div className="flex flex-col gap-2">
            <p role="status">{localize('com_meeting_voice_abandoned')}</p>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => voice.cancelAbandoned(remoteActive.id)}
            >
              {localize('com_meeting_voice_cancel')}
            </Button>
          </div>
        )}
      {voice.state === 'failed' && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => {
            if (voice.canRetry) void voice.cancel();
            document.getElementById('meeting-question')?.focus();
          }}
        >
          {localize('com_meeting_voice_text')}
        </Button>
      )}
      {!compact && (
        <p className="text-text-secondary text-sm">{localize('com_meeting_voice_resume')}</p>
      )}
    </section>
  );
}
