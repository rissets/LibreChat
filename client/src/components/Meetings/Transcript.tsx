import { useState } from 'react';
import { Button, Input } from '@librechat/client';
import type { TMeetingSession } from 'librechat-data-provider';
import type { MeetingMicrophone } from './capture';
import { useMeetingTranscript } from '~/data-provider/Meetings';
import { captureErrorLabels } from './capture-errors';
import { useMeetingAudioSession } from './audio';
import { formatMeetingTime } from './time';
import { useLocalize } from '~/hooks';
import Limits from './Limits';

function playbackLabel(state: string) {
  if (state === 'playing') return 'com_meeting_playback_active';
  if (state === 'preparing') return 'com_meeting_playback_starting';
  return 'com_meeting_playback_stopped';
}

export default function Transcript({
  session,
  userId,
  microphone,
  view,
}: {
  session: TMeetingSession;
  userId?: string;
  microphone: MeetingMicrophone;
  view: 'recording' | 'transcript';
}) {
  const localize = useLocalize();
  const transcript = useMeetingTranscript(userId, session.id);
  const audio = useMeetingAudioSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const segments = (transcript.data?.segments ?? []).filter((segment) =>
    segment.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(segments.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const busy =
    audio.owner !== null ||
    ['requesting', 'capturing', 'stopping', 'checking'].includes(microphone.state);
  const playbackActive =
    transcript.data?.playbacks.some(
      (value) => ['preparing', 'playing'].includes(value.state) && value.lease_remaining_ms > 0,
    ) ?? false;
  const started = !!transcript.data?.capture;
  const durationEnded = transcript.data?.limits.error_code === 'MEETING_DURATION_LIMIT';
  const statusLabels = {
    idle: started ? 'com_meeting_capture_ended' : 'com_meeting_capture_not_started',
    stopped: 'com_meeting_capture_ended',
    error: 'com_meeting_capture_ended',
    capturing: 'com_meeting_capture_active',
    requesting: 'com_meeting_capture_requesting',
    stopping: 'com_meeting_capture_stopping',
    checking: 'com_meeting_capture_checking',
    paused: 'com_meeting_capture_paused',
    recoverable: 'com_meeting_capture_recoverable',
  } as const;
  return (
    <section className="flex flex-col gap-4" aria-label={localize('com_meeting_live_transcript')}>
      {view === 'recording' && (
        <>
          {transcript.data?.limits && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {localize('com_meeting_details_limits')}
              </summary>
              <div className="mt-3">
                <Limits value={transcript.data.limits} />
              </div>
            </details>
          )}
          <div className="border-border-light flex flex-col gap-3 rounded-xl border p-4">
            <label htmlFor="meeting-microphone">{localize('com_meeting_microphone')}</label>
            <select
              id="meeting-microphone"
              value={microphone.deviceId}
              disabled={busy}
              onChange={(event) => microphone.setDeviceId(event.target.value)}
              className="border-border-light bg-surface-primary min-h-10 rounded-lg border p-2"
            >
              <option value="">{localize('com_meeting_default_microphone')}</option>
              {microphone.devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || localize('com_meeting_microphone') + ' ' + (index + 1)}
                </option>
              ))}
            </select>
            <label htmlFor="meeting-input-level">{localize('com_meeting_input_level')}</label>
            <meter
              id="meeting-input-level"
              min={0}
              max={1}
              value={microphone.level}
              className="w-full"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void microphone.check()}
                disabled={
                  busy || started || !microphone.supported || !microphone.ready || playbackActive
                }
              >
                {localize('com_meeting_check_microphone')}
              </Button>
              <Button
                onClick={() => void microphone.start()}
                disabled={
                  busy || started || !microphone.supported || !microphone.ready || playbackActive
                }
              >
                {localize('com_meeting_start_capture')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void microphone.pause()}
                disabled={microphone.state !== 'capturing'}
              >
                {localize('com_meeting_pause_capture')}
              </Button>
              {microphone.state === 'paused' && (
                <Button
                  onClick={() => void microphone.resume()}
                  disabled={!microphone.supported || !microphone.ready || busy || playbackActive}
                >
                  {localize('com_meeting_resume_capture')}
                </Button>
              )}
              {started &&
                ['recoverable', 'error'].includes(microphone.state) &&
                !['stopped', 'failed'].includes(transcript.data?.capture?.state ?? '') && (
                  <Button
                    onClick={() => void microphone.reconnect()}
                    disabled={!microphone.ready || busy || playbackActive}
                  >
                    {localize('com_meeting_reconnect_capture')}
                  </Button>
                )}
              <Button
                variant="outline"
                onClick={() => void microphone.stop()}
                disabled={
                  !['capturing', 'checking', 'paused'].includes(microphone.state) &&
                  !(
                    started &&
                    microphone.pending === 0 &&
                    ['recoverable', 'error'].includes(microphone.state)
                  )
                }
              >
                {localize('com_meeting_stop_capture')}
              </Button>
            </div>
            <p role="status" aria-live="polite">
              {localize(statusLabels[microphone.state])}
            </p>
            {!microphone.supported && <p role="alert">{localize('com_meeting_mic_unsupported')}</p>}
            {microphone.error && (
              <p role="alert">{localize(captureErrorLabels[microphone.error])}</p>
            )}
            {transcript.data?.acknowledgements.some((value) =>
              ['rejected', 'uncertain'].includes(value.state),
            ) && <p role="alert">{localize('com_meeting_asr_error')}</p>}
            {microphone.pending > 0 && (
              <p role="status">
                {durationEnded
                  ? localize('com_meeting_pending_after_duration')
                  : localize('com_meeting_pending_audio', { count: microphone.pending })}
              </p>
            )}
            {microphone.pending > 0 && durationEnded && (
              <Button variant="outline" onClick={() => void microphone.discardPending()}>
                {localize('com_meeting_discard_pending')}
              </Button>
            )}
            {!microphone.connected && <p role="status">{localize('com_meeting_offline_buffer')}</p>}
            {microphone.pending > 0 &&
              !durationEnded &&
              ['error', 'recoverable'].includes(microphone.state) && (
                <Button variant="outline" onClick={() => void microphone.reconnect(true)}>
                  {localize('com_meeting_discard_audio')}
                </Button>
              )}
            <details className="text-text-secondary text-sm">
              <summary className="cursor-pointer">
                {localize('com_meeting_details_audio_info')}
              </summary>
              <p className="mt-2">{localize('com_meeting_temporary_audio')}</p>
              <p className="mt-2">{localize('com_meeting_browser_recovery_limit')}</p>
            </details>
          </div>
        </>
      )}
      {view === 'transcript' && (
        <>
          <h3 className="text-lg font-semibold">{localize('com_meeting_live_transcript')}</h3>
          <p className="text-text-secondary">{localize('com_meeting_timing_precision')}</p>
          {!!transcript.data?.playbacks.length && (
            <section
              aria-label={localize('com_meeting_ai_playback_intervals')}
              className="border-border-light rounded-lg border p-3"
            >
              <h4 className="font-medium">{localize('com_meeting_ai_playback_intervals')}</h4>
              <p className="text-text-secondary">
                {localize('com_meeting_ai_playback_not_participant')}
              </p>
              <ul>
                {transcript.data.playbacks.map((value) => (
                  <li key={value.id}>
                    {new Date(value.started_at ?? value.requested_at).toLocaleTimeString()} ·{' '}
                    {localize(playbackLabel(value.state))}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {transcript.isError ? (
            <div role="alert">
              <p>{localize('com_meeting_error')}</p>
              <Button variant="outline" onClick={() => transcript.refetch()}>
                {localize('com_meeting_retry')}
              </Button>
            </div>
          ) : null}
          {!transcript.data?.segments.length && <p>{localize('com_meeting_transcript_empty')}</p>}
          {!!transcript.data?.gaps.length && (
            <section
              aria-label={localize('com_meeting_gaps')}
              className="border-border-light rounded-lg border p-3"
            >
              <h4 className="font-medium">{localize('com_meeting_gaps')}</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {transcript.data.gaps.map((gap) => {
                  const limited = gap.reason === 'duration_limit';
                  const endLabel = localize(
                    limited ? 'com_meeting_gap_after_limit' : 'com_meeting_gap_open',
                  );
                  let description = localize(
                    gap.reason === 'paused'
                      ? 'com_meeting_gap_paused'
                      : 'com_meeting_gap_interrupted',
                  );
                  if (limited) description = localize('com_meeting_gap_duration_limit');
                  return (
                    <li key={gap.id}>
                      <span>
                        {formatMeetingTime(gap.start_ms)}–
                        {gap.end_ms === null ? endLabel : formatMeetingTime(gap.end_ms)}
                      </span>
                      {' · '}
                      {description}
                      {gap.time_precision === 'unknown' && (
                        <span>
                          {' · '}
                          {localize('com_meeting_gap_unknown')}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            aria-label={localize('com_meeting_workspace_search_transcript')}
            placeholder={localize('com_meeting_workspace_search_transcript')}
          />
          {search && segments.length === 0 && (
            <p role="status">{localize('com_meeting_details_no_matches')}</p>
          )}
          <ol className="flex flex-col gap-3" aria-live="polite" aria-relevant="additions text">
            {segments.slice(currentPage * 50, (currentPage + 1) * 50).map((segment) => (
              <li key={segment.id} className="border-border-light rounded-lg border p-3">
                <div className="text-text-secondary flex flex-wrap gap-3 text-sm">
                  <span>
                    {formatMeetingTime(segment.start_ms)}–{formatMeetingTime(segment.end_ms)}
                  </span>
                  <span>
                    {localize(
                      segment.state === 'provisional'
                        ? 'com_meeting_provisional'
                        : 'com_meeting_stable',
                    )}
                  </span>
                  <span>{segment.speaker ?? localize('com_meeting_speaker_unknown')}</span>
                </div>
                <p className="mt-2 break-words whitespace-pre-wrap">{segment.text}</p>
                {segment.human_corrected ? (
                  <p className="text-text-secondary text-sm">
                    {localize('com_meeting_review_human_transcript')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {pageCount > 1 && (
            <nav
              className="flex items-center justify-between gap-3"
              aria-label={localize('com_meeting_details_pages')}
            >
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {localize('com_meeting_details_previous')}
              </Button>
              <span className="text-text-secondary text-sm" aria-live="polite">
                {currentPage + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {localize('com_meeting_details_next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
