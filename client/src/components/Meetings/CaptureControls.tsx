import { Button } from '@librechat/client';
import { Mic, Pause, Play, Square } from 'lucide-react';
import type { MeetingMicrophone } from './capture';
import { useMeetingTranscript } from '~/data-provider/Meetings';
import { captureErrorLabels } from './capture-errors';
import { useMeetingAudioSession } from './audio';
import { useLocalize } from '~/hooks';

/** Capture begins explicitly inside its workspace, never from shell navigation. */
export default function CaptureControls({
  meetingId,
  userId,
  microphone,
}: {
  meetingId: string;
  userId?: string;
  microphone: MeetingMicrophone;
}) {
  const localize = useLocalize();
  const transcript = useMeetingTranscript(userId, meetingId);
  const audio = useMeetingAudioSession();
  const started = !!transcript.data?.capture || microphone.state === 'stopped';
  const active = ['capturing', 'paused'].includes(microphone.state);
  const busy = ['requesting', 'checking', 'stopping'].includes(microphone.state);
  const playbackActive = transcript.data?.playbacks.some(
    (value) => ['preparing', 'playing'].includes(value.state) && value.lease_remaining_ms > 0,
  );
  const incomplete = transcript.data?.acknowledgements.some((ack) =>
    ['uncertain', 'rejected'].includes(ack.state),
  );
  const blocked =
    busy || audio.owner !== null || playbackActive || !microphone.ready || !microphone.supported;
  return (
    <div
      className="border-border-light bg-surface-secondary/50 flex flex-wrap items-center gap-2.5 rounded-xl border p-2.5 shadow-xs"
      aria-label={localize('com_meeting_recording_controls')}
    >
      <label className="sr-only" htmlFor="workspace-microphone">
        {localize('com_meeting_microphone')}
      </label>
      <select
        id="workspace-microphone"
        value={microphone.deviceId}
        disabled={busy || active}
        onChange={(event) => microphone.setDeviceId(event.target.value)}
        className="border-border-light bg-surface-primary text-text-primary focus-visible:ring-primary h-9 max-w-full min-w-0 rounded-lg border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2"
      >
        <option value="">{localize('com_meeting_default_microphone')}</option>
        {microphone.devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || localize('com_meeting_microphone') + ' ' + (index + 1)}
          </option>
        ))}
      </select>
      {!started && !active && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() => void microphone.check()}
          >
            {localize('com_meeting_check_microphone')}
          </Button>
          <Button
            size="sm"
            disabled={blocked || transcript.isLoading}
            onClick={() => void microphone.start()}
          >
            <Mic className="size-4" aria-hidden="true" />
            {localize('com_meeting_start_capture')}
          </Button>
        </>
      )}
      {microphone.state === 'capturing' && (
        <Button size="sm" variant="outline" onClick={() => void microphone.pause()}>
          <Pause className="size-4" aria-hidden="true" />
          {localize('com_meeting_pause_capture')}
        </Button>
      )}
      {microphone.state === 'paused' && (
        <Button
          size="sm"
          variant="outline"
          disabled={blocked}
          onClick={() => void microphone.resume()}
        >
          <Play className="size-4" aria-hidden="true" />
          {localize('com_meeting_resume_capture')}
        </Button>
      )}
      {(active || microphone.state === 'checking') && (
        <Button size="sm" variant="outline" onClick={() => void microphone.stop()}>
          <Square className="size-4" aria-hidden="true" />
          {localize('com_meeting_stop_capture')}
        </Button>
      )}
      {microphone.state === 'checking' && (
        <meter
          min={0}
          max={1}
          value={microphone.level}
          aria-label={localize('com_meeting_input_level')}
        />
      )}
      {microphone.error && (
        <p role="alert" className="w-full text-sm">
          {localize(captureErrorLabels[microphone.error])}
        </p>
      )}
      {microphone.pending > 0 && (
        <span role="status" className="text-text-secondary text-xs">
          {localize('com_meeting_audio_saving')}
        </span>
      )}
      {incomplete && (
        <p role="status" className="text-text-secondary w-full text-sm">
          {localize('com_meeting_transcript_partial')}
        </p>
      )}
    </div>
  );
}
