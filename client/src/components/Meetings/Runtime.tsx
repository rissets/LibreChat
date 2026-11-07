import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as Ariakit from '@ariakit/react';
import { Ellipsis, Pause, Play, Square } from 'lucide-react';
import { Button, IconButton, useToastContext } from '@librechat/client';
import type { TMeetingSession } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranscriptQuery, SwitchGuard } from './runtime-context';
import type { MeetingMicrophone } from './capture';
import { subscribeMeetingAccessLoss, useMeetingBoundary } from '~/data-provider/Meetings/access';
import { useMeetingAccess, useMeetingTranscript } from '~/data-provider/Meetings';
import { parseMeetingChatPath } from '~/data-provider/Meetings/path';
import { Context, inactive, useMeetingRuntime } from './runtime-context';
import { MeetingAudioSession, useMeetingAudioSession } from './audio';
import { captureErrorLabels } from './capture-errors';
import { useMicrophoneCapture } from './capture';
import { formatMeetingTime } from './time';
import { useLocalize } from '~/hooks';
export { useMeetingRuntime, useActiveMeeting } from './runtime-context';

interface CaptureSnapshot {
  session: TMeetingSession;
  microphone: MeetingMicrophone;
  transcript: TranscriptQuery;
}
/** This host never belongs to a route. Only changing the selected meeting releases its resources. */
const CaptureHost = memo(function CaptureHost({
  userId,
  session,
  publish,
}: {
  userId: string;
  session: TMeetingSession;
  publish: (value: CaptureSnapshot) => void;
}) {
  useMeetingBoundary(userId, session.id);
  const transcript = useMeetingTranscript(userId, session.id);
  const microphone = useMicrophoneCapture(userId, session.id, transcript.data);
  useLayoutEffect(() => {
    publish({ session, microphone, transcript });
  }, [session, microphone, transcript, publish]);
  return null;
});

function Runtime({ children, userId }: { children: ReactNode; userId: string }) {
  const [selected, setSelected] = useState<TMeetingSession | null>(null);
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | null>(null);
  const selection = useRef(selected);
  const revoked = useRef(new WeakSet<TMeetingSession>());
  const guard = useRef<SwitchGuard | null>(null);
  const queued = useRef<TMeetingSession | null>(null);
  const switching = useRef<Promise<boolean> | null>(null);
  const [switchBlocked, setSwitchBlocked] = useState(false);
  const localize = useLocalize();
  const audio = useMeetingAudioSession();
  const { stopAll } = audio;
  const access = useMeetingAccess(userId, selected !== null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (access.data?.allowed === false && parseMeetingChatPath(pathname.slice(3)))
      navigate('/c/new', { replace: true });
  }, [access.data?.allowed, pathname, navigate]);
  const publish = useCallback((value: CaptureSnapshot) => {
    setSnapshot(value);
  }, []);
  const microphone = snapshot?.microphone;
  const canSwitch =
    audio.owner === null &&
    (!selected ||
      (microphone &&
        ['idle', 'stopped', 'error'].includes(microphone.state) &&
        microphone.pending === 0));
  const switchAllowed = useRef(canSwitch);
  switchAllowed.current = canSwitch;
  const beforeSwitch = useCallback((value: SwitchGuard) => {
    guard.current = value;
    return () => {
      if (guard.current === value) guard.current = null;
    };
  }, []);
  const attach = useCallback(
    (session: TMeetingSession) => {
      if (revoked.current.has(session)) return false;
      if (selection.current?.id === session.id) {
        queued.current = null;
        setSwitchBlocked(false);
        return true;
      }
      if (!canSwitch) return false;
      queued.current = session;
      if (switching.current) return false;
      const allowed = guard.current?.() ?? true;
      if (allowed !== true) {
        setSwitchBlocked(true);
        if (allowed !== false) {
          const registered = guard.current;
          const previous = selection.current;
          switching.current = allowed;
          void allowed.then((saved) => {
            switching.current = null;
            const target = queued.current;
            if (
              !saved ||
              !target ||
              guard.current !== registered ||
              selection.current !== previous ||
              !switchAllowed.current ||
              revoked.current.has(target)
            )
              return;
            queued.current = null;
            selection.current = target;
            setSwitchBlocked(false);
            setSnapshot(null);
            setSelected(target);
          });
        }
        return false;
      }
      queued.current = null;
      setSwitchBlocked(false);
      selection.current = session;
      setSnapshot(null);
      setSelected(session);
      return true;
    },
    [canSwitch],
  );
  useEffect(
    () =>
      subscribeMeetingAccessLoss({ userId, meetingId: selected?.id }, (reason, change) => {
        if (reason === 'transport' || reason === 'hidden') return;
        if (
          reason === 'lifecycle' &&
          change?.value.classes.transcript?.available !== false &&
          change?.value.classes.meeting?.available !== false
        )
          return;
        // Erase the shell's private title/transcript as well as releasing capture and playback.
        void stopAll();
        if (selection.current) revoked.current.add(selection.current);
        selection.current = null;
        queued.current = null;
        setSwitchBlocked(false);
        setSnapshot(null);
        setSelected(null);
      }),
    [userId, selected?.id, stopAll],
  );
  const value = useMemo(
    () => ({
      userId,
      session: selected,
      microphone: snapshot?.microphone ?? null,
      transcript: snapshot?.transcript ?? null,
      attach,
      beforeSwitch,
    }),
    [userId, selected, snapshot, attach, beforeSwitch],
  );
  return (
    <Context.Provider value={value}>
      {switchBlocked && selected && (
        <p
          role="alert"
          className="border-border-light bg-surface-secondary border-b px-4 py-2 text-sm"
        >
          {localize('com_meeting_review_save_before_switch')}{' '}
          <Link className="underline" to={'/meetings/' + selected.id}>
            {localize('com_meeting_review_return_to_save')}
          </Link>
        </p>
      )}
      {selected && (
        <CaptureHost key={selected.id} userId={userId} session={selected} publish={publish} />
      )}
      {children}
    </Context.Provider>
  );
}

/** Authenticated shell boundary; account changes and real shell teardown dispose capture. */
export function MeetingRuntimeProvider({
  children,
  userId,
}: {
  children: ReactNode;
  userId?: string;
}) {
  return (
    <MeetingAudioSession key={userId}>
      {userId ? (
        <Runtime userId={userId}>{children}</Runtime>
      ) : (
        <Context.Provider value={inactive}>{children}</Context.Provider>
      )}
    </MeetingAudioSession>
  );
}

function Elapsed({ transcript, recording }: { transcript: TranscriptQuery; recording: boolean }) {
  const [elapsed, setElapsed] = useState(transcript.data?.capture?.elapsed_ms ?? 0);
  const clock = useRef({ elapsed, at: Date.now(), recording });
  const serverElapsed = transcript.data?.capture?.elapsed_ms ?? 0;
  useEffect(() => {
    const now = Date.now();
    const previous = clock.current;
    clock.current = {
      elapsed: Math.max(
        serverElapsed,
        previous.elapsed + (previous.recording ? now - previous.at : 0),
      ),
      at: now,
      recording,
    };
    const update = () =>
      setElapsed(clock.current.elapsed + (recording ? Date.now() - clock.current.at : 0));
    update();
    if (!recording) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [recording, serverElapsed]);
  return (
    <span className="tabular-nums" aria-live="off">
      {formatMeetingTime(elapsed)}
    </span>
  );
}

/** A route-independent shortcut; idle and finished meetings leave no shell chrome. */
export function MeetingRecordingStrip() {
  const { session, microphone, transcript } = useMeetingRuntime();
  const { pathname } = useLocation();
  const audio = useMeetingAudioSession();
  const localize = useLocalize();
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-end' });
  const microphoneState = microphone?.state;
  const captureError = microphone?.error;
  const { showToast } = useToastContext();
  const notify = useRef({ showToast, localize });
  notify.current = { showToast, localize };
  useEffect(() => {
    if (captureError)
      notify.current.showToast({
        message: notify.current.localize(captureErrorLabels[captureError]),
        status: 'error',
      });
  }, [captureError, session?.id]);
  useEffect(() => {
    if (!microphoneState || ['idle', 'stopped', 'error'].includes(microphoneState)) popover.hide();
  }, [microphoneState, popover]);
  if (!session || !microphone || !transcript) return null;
  if (!['capturing', 'paused'].includes(microphone.state)) return null;
  const inWorkspace = pathname === '/meetings/' + session.id;
  const recording = microphone.state === 'capturing';
  const playbackActive =
    transcript.data?.playbacks.some(
      (value) => ['preparing', 'playing'].includes(value.state) && value.lease_remaining_ms > 0,
    ) ?? false;
  return (
    <section
      aria-label={localize('com_meeting_runtime_active')}
      className={
        'border-border-light bg-surface-secondary text-text-primary fixed z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border py-1 ps-3 pe-1 text-xs ' +
        (inWorkspace ? 'bottom-4 left-1/2 -translate-x-1/2 shadow-lg' : 'inset-e-4 top-16')
      }
    >
      <span className="bg-status-error size-2 shrink-0 rounded-full" aria-hidden="true" />
      {inWorkspace && !recording && <span>{localize('com_meeting_runtime_paused')}</span>}
      <Link
        to={'/meetings/' + encodeURIComponent(session.id)}
        aria-label={localize('com_meeting_runtime_return') + ': ' + session.title}
        className="focus-visible:ring-focus-control flex min-h-8 min-w-0 items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <span className="max-w-24 truncate font-medium sm:max-w-40">{session.title}</span>
        <Elapsed key={session.id} transcript={transcript} recording={recording} />
      </Link>
      <Ariakit.PopoverProvider store={popover}>
        <Ariakit.PopoverDisclosure
          render={
            <IconButton
              label={localize('com_meeting_recording_controls')}
              size="sm"
              shape="round"
              variant="ghost"
            />
          }
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </Ariakit.PopoverDisclosure>
        <Ariakit.Popover
          portal
          gutter={8}
          unmountOnHide
          aria-label={localize('com_meeting_recording_controls')}
          className="popover-animate border-border-medium bg-surface-secondary text-text-primary rounded-theme-popover z-50 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 border p-3 shadow-lg"
        >
          <p role="status" className="text-sm">
            {localize(recording ? 'com_meeting_runtime_recording' : 'com_meeting_runtime_paused')}
          </p>
          <div className="flex flex-wrap gap-2">
            {recording ? (
              <Button variant="outline" size="sm" onClick={() => void microphone.pause()}>
                <Pause className="size-4" aria-hidden="true" />
                {localize('com_meeting_pause_capture')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  audio.owner !== null ||
                  playbackActive ||
                  !microphone.ready ||
                  !microphone.supported
                }
                onClick={() => void microphone.resume()}
              >
                <Play className="size-4" aria-hidden="true" />
                {localize('com_meeting_resume_capture')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void microphone.stop()}>
              <Square className="size-4" aria-hidden="true" />
              {localize('com_meeting_stop_capture')}
            </Button>
          </div>
          {microphone.pending > 0 && (
            <p role="status" className="text-text-secondary text-xs">
              {localize('com_meeting_audio_saving')}
            </p>
          )}
        </Ariakit.Popover>
      </Ariakit.PopoverProvider>
      {inWorkspace && (
        <Button size="sm" variant="outline" onClick={() => void microphone.stop()}>
          <Square className="size-4" aria-hidden="true" />
          {localize('com_meeting_stop_capture')}
        </Button>
      )}
    </section>
  );
}
