import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, Input, Spinner } from '@librechat/client';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Calendar, Plus, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  useCreateMeeting,
  useMeeting,
  useMeetingAccess,
  useMeetingLifecycle,
  useMeetings,
} from '~/data-provider/Meetings';
import { SharedMeetingList, SharedMeetingResult, SharedMeetingAnswer } from './SharedResults';
import { useMeetingBoundary } from '~/data-provider/Meetings/access';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { discardBuffer, purgeBuffers } from './buffer';
import { useAuthContext, useLocalize } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { meetingLimitError } from './limit-errors';
import { useMeetingRuntime } from './runtime-context';
import LifecyclePanel from './LifecyclePanel';
import Session from './Session';

export default function Meetings() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { meetingId } = useParams();
  const boundary = useMeetingBoundary(user?.id, meetingId);
  const [search] = useSearchParams();
  const sharedVersion = Number(search.get('sharedVersion'));
  const sharedAnswer = search.get('sharedAnswer');
  const shared = search.has('sharedVersion') || !!sharedAnswer;
  const navigate = useNavigate();
  const isSmallScreen = useDrawerViewport();
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [agenda, setAgenda] = useState('');
  const [stopError, setStopError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const runtime = useMeetingRuntime();
  const { data: startup } = useGetStartupConfig();
  const featureEnabled = startup?.interface?.meetingCopilot === true;
  const access = useMeetingAccess(user?.id, featureEnabled);
  const allowed = access.data?.allowed === true;
  const accessDenied =
    isAxiosError(access.error) && [401, 403].includes(access.error.response?.status ?? 0);
  const sessions = useMeetings(user?.id, allowed && !meetingId, page);
  const session = useMeeting(user?.id, meetingId, allowed && !shared);
  const lifecycle = useMeetingLifecycle(user?.id, meetingId, allowed);
  const [bufferFailed, setBufferFailed] = useState(false);
  useEffect(() => {
    void purgeBuffers().catch(() => setBufferFailed(true));
  }, [user?.id]);
  const sourceAvailable = lifecycle.data?.classes.transcript?.available;
  useEffect(() => {
    if (user?.id && meetingId && sourceAvailable === false)
      void discardBuffer(user.id + ':' + meetingId).catch(() => setBufferFailed(true));
  }, [user?.id, meetingId, sourceAvailable]);
  const create = useCreateMeeting(user?.id);
  let createErrorLabel = localize('com_meeting_error');
  if (meetingLimitError(create.error) === 'concurrency') {
    createErrorLabel = localize('com_meeting_concurrency_full');
  } else if (
    isAxiosError(create.error) &&
    [401, 403].includes(create.error.response?.status ?? 0)
  ) {
    createErrorLabel = localize('com_meeting_denied');
  }
  const loading = (
    <div role="status" aria-label={localize('com_ui_loading')}>
      <Spinner className="size-5" />
    </div>
  );

  let content: ReactNode;
  if (boundary.lost) {
    content = (
      <div role="alert">
        <p>{localize('com_meeting_shared_unavailable')}</p>
        <Button
          variant="outline"
          onClick={() => {
            boundary.retry();
            void access.refetch();
          }}
        >
          {localize('com_meeting_retry')}
        </Button>
      </div>
    );
  } else if (!featureEnabled || (!access.isLoading && !access.isError && !allowed)) {
    content = <p role="status">{localize('com_meeting_denied')}</p>;
  } else if (access.isLoading) {
    content = loading;
  } else if (access.isError && (!allowed || accessDenied)) {
    content = (
      <div role="alert">
        <p>{localize(accessDenied ? 'com_meeting_denied' : 'com_meeting_error')}</p>
        <Button variant="outline" onClick={() => access.refetch()}>
          {localize('com_meeting_retry')}
        </Button>
      </div>
    );
  } else if (meetingId && shared) {
    if (lifecycle.data?.classes[sharedAnswer ? 'answers' : 'results']?.available === false) {
      content = <p role="status">{localize('com_meeting_lifecycle_unavailable')}</p>;
    } else if (sharedAnswer && /^[a-f0-9-]{36}$/.test(sharedAnswer)) {
      content = (
        <SharedMeetingAnswer
          key={meetingId + sharedAnswer}
          userId={user?.id}
          meetingId={meetingId}
          answerId={sharedAnswer}
        />
      );
    } else if (
      Number.isSafeInteger(sharedVersion) &&
      sharedVersion > 0 &&
      sharedVersion <= 1000000
    ) {
      content = (
        <SharedMeetingResult
          key={meetingId + ':' + sharedVersion}
          userId={user?.id}
          meetingId={meetingId}
          version={sharedVersion}
        />
      );
    } else {
      content = <p role="alert">{localize('com_meeting_shared_unavailable')}</p>;
    }
  } else if (meetingId) {
    let details: ReactNode = null;
    if (lifecycle.data?.classes.transcript?.available === false) {
      details = <p role="status">{localize('com_meeting_lifecycle_unavailable')}</p>;
    } else if (session.isLoading) {
      details = loading;
    } else if (
      session.isError &&
      (!session.data ||
        (isAxiosError(session.error) &&
          [401, 403, 404].includes(session.error.response?.status ?? 0)))
    ) {
      details = (
        <div role="alert">
          <p>{localize('com_meeting_unavailable')}</p>
          <Button variant="outline" onClick={() => session.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      );
    } else if (session.data) {
      details = <Session session={session.data} userId={user?.id} />;
    }
    content = (
      <section
        className="flex min-h-0 flex-1 flex-col gap-3"
        aria-label={localize('com_meeting_session')}
      >
        <Link to="/meetings" className="text-text-secondary underline">
          {localize('com_meeting_back')}
        </Link>
        {details}
      </section>
    );
  } else {
    let list: ReactNode;
    if (sessions.isLoading) {
      list = loading;
    } else if (sessions.isError) {
      list = (
        <div role="alert">
          <p>{localize('com_meeting_error')}</p>
          <Button variant="outline" onClick={() => sessions.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      );
    } else if (sessions.data?.sessions.length === 0) {
      list = (
        <div className="border-border-light bg-surface-secondary/30 flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <Calendar className="text-text-tertiary mb-2 size-8" aria-hidden="true" />
          <p className="text-text-secondary text-sm font-medium">{localize('com_meeting_empty')}</p>
        </div>
      );
    } else {
      list = (
        <div className="border-border-light overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-secondary text-text-secondary">
              <tr>
                <th scope="col" className="p-3">
                  Nama meeting
                </th>
                <th scope="col" className="p-3">
                  Tanggal
                </th>
                <th scope="col" className="p-3">
                  Agenda
                </th>
                <th scope="col" className="p-3">
                  Status
                </th>
                <th scope="col" className="p-3">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.data?.sessions.map((value) => (
                <tr key={value.id} className="border-border-light border-t">
                  <td className="p-3 font-medium">
                    {value.title || localize('com_meeting_lifecycle_removed_meeting')}
                  </td>
                  <td className="p-3 whitespace-nowrap">{value.meeting_date || '—'}</td>
                  <td className="max-w-xs p-3 break-words whitespace-pre-wrap">
                    {value.agenda || '—'}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className="bg-surface-tertiary rounded px-2 py-1">
                      {
                        (
                          {
                            not_started: 'Belum dimulai',
                            capturing: 'Merekam',
                            paused: 'Dijeda',
                            interrupted: 'Terputus',
                            stopped: 'Selesai',
                            failed: 'Gagal',
                          } as const
                        )[value.capture_state]
                      }
                    </span>
                  </td>
                  <td className="p-3">
                    <Link className="text-primary underline" to={'/meetings/' + value.id}>
                      Buka detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    content = (
      <>
        <form
          className="border-border-light bg-surface-secondary/40 flex flex-col gap-3 rounded-2xl border p-5 shadow-xs transition-all"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !meetingDate || !agenda.trim() || create.isLoading) return;
            create.mutate(
              { title: title.trim(), meeting_date: meetingDate, agenda: agenda.trim() },
              { onSuccess: (value) => navigate('/meetings/' + value.id) },
            );
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary size-4" aria-hidden="true" />
            <label htmlFor="meeting-title" className="text-sm font-semibold">
              {localize('com_meeting_name')}
            </label>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Input
              id="meeting-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Contoh: Rapat Koordinasi Anggaran & Evaluasi Proyek"
              required
              maxLength={200}
              disabled={create.isLoading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={!title.trim() || !meetingDate || !agenda.trim() || create.isLoading}
              className="shrink-0"
            >
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              {localize(create.isLoading ? 'com_meeting_creating' : 'com_meeting_create')}
            </Button>
          </div>
          <label htmlFor="meeting-date" className="text-sm font-semibold">
            Tanggal meeting
          </label>
          <Input
            id="meeting-date"
            type="date"
            value={meetingDate}
            onChange={(event) => setMeetingDate(event.target.value)}
            required
            disabled={create.isLoading}
          />
          <label htmlFor="meeting-agenda" className="text-sm font-semibold">
            Agenda
          </label>
          <textarea
            id="meeting-agenda"
            value={agenda}
            onChange={(event) => setAgenda(event.target.value)}
            required
            maxLength={4000}
            disabled={create.isLoading}
            className="border-border-light bg-surface-primary min-h-24 rounded-lg border p-3 text-sm"
          />
          {create.isError ? (
            <p role="alert" className="text-xs text-red-500">
              {createErrorLabel}
            </p>
          ) : null}
        </form>
        <section aria-label={localize('com_meeting_list')} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{localize('com_meeting_list')}</h2>
            {runtime.session &&
              runtime.microphone &&
              !['idle', 'stopped'].includes(runtime.microphone.state) && (
                <Button
                  variant="outline"
                  disabled={stopping}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Hentikan rekaman aktif? Audio yang belum terkirim akan diproses terlebih dahulu.',
                      )
                    )
                      return;
                    setStopping(true);
                    setStopError(false);
                    try {
                      if (!(await runtime.microphone?.stop())) setStopError(true);
                      await sessions.refetch();
                    } catch {
                      setStopError(true);
                    } finally {
                      setStopping(false);
                    }
                  }}
                >
                  Hentikan rekaman aktif
                </Button>
              )}
          </div>
          {stopError && (
            <p role="alert">Rekaman belum dapat dihentikan. Periksa koneksi dan coba lagi.</p>
          )}
          {list}
          {!sessions.isError && (page > 1 || sessions.data?.has_more) && (
            <nav
              aria-label={localize('com_meeting_list_pages')}
              className="flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={page === 1 || sessions.isFetching}
                onClick={() => setPage((value) => value - 1)}
              >
                {localize('com_meeting_details_previous')}
              </Button>
              <span className="text-text-secondary text-sm" aria-live="polite">
                {localize('com_meeting_list_page', { 0: page })}
              </span>
              <Button
                variant="outline"
                disabled={!sessions.data?.has_more || sessions.isFetching}
                onClick={() => setPage((value) => value + 1)}
              >
                {localize('com_meeting_details_next')}
              </Button>
            </nav>
          )}
        </section>
        <SharedMeetingList userId={user?.id} enabled={allowed} />
      </>
    );
  }
  return (
    <main className="bg-surface-primary text-text-primary flex h-full min-h-0 w-full flex-col overflow-y-auto p-4 md:p-6">
      <div
        className={
          meetingId && !shared
            ? 'mx-auto flex w-full max-w-screen-2xl shrink-0 flex-col gap-4 lg:min-h-0 lg:flex-1'
            : 'mx-auto flex w-full max-w-3xl flex-col gap-6'
        }
      >
        {(!meetingId || shared) && (
          <header>
            <div className="flex items-center gap-3">
              {isSmallScreen && <OpenSidebar className="size-9 shrink-0" />}
              <h1 className="text-2xl font-semibold">{localize('com_meeting_title')}</h1>
            </div>
            <p className="text-text-secondary mt-2">{localize('com_meeting_private')}</p>
          </header>
        )}
        {meetingId && shared && <LifecyclePanel value={lifecycle.data} />}
        {bufferFailed && <p role="alert">{localize('com_meeting_lifecycle_buffer_failed')}</p>}
        {content}
      </div>
    </main>
  );
}
