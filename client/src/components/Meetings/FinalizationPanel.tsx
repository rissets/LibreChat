import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import type { TMeetingFinalResult, TMeetingSession } from 'librechat-data-provider';
import {
  useFinalizeMeeting,
  useMeetingFinalEvidence,
  useMeetingFinalization,
  useReviewMeetingResult,
} from '~/data-provider/Meetings';
import ResultEditor, { resultConflict } from './ResultEditor';
import { useMeetingAudioSession } from './audio';
import { formatMeetingTime } from './time';
import SharingPanel from './SharingPanel';
import { useLocalize } from '~/hooks';

type Reference = TMeetingFinalResult['summary'][number]['citations'][number];

export default function FinalizationPanel({
  session,
  userId,
}: {
  session: TMeetingSession;
  userId?: string;
}) {
  const localize = useLocalize();
  const audio = useMeetingAudioSession();
  const [version, setVersion] = useState<number | undefined>();
  const [editing, setEditing] = useState<TMeetingFinalResult | null>(null);
  const [notice, setNotice] = useState<number | null>(null);
  const noticePanel = useRef<HTMLParagraphElement | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const returnToEdit = useRef(false);
  const status = useMeetingFinalization(userId, session.id, version);
  const review = useReviewMeetingResult(userId, session.id);
  const reviewId = useRef<string | null>(null);
  const finalize = useFinalizeMeeting(userId, session.id);
  const retry = useFinalizeMeeting(userId, session.id, true);
  const requestId = useRef<string | null>(null);
  const retryId = useRef<string | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const evidencePanel = useRef<HTMLElement | null>(null);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceId = 'meeting-final-evidence-' + session.id;
  useEffect(() => {
    if (reference) evidencePanel.current?.focus();
  }, [reference]);
  useEffect(() => {
    if (notice != null) noticePanel.current?.focus();
  }, [notice]);
  const result = !status.isError ? status.data?.result : undefined;
  useEffect(() => {
    if (!editing && returnToEdit.current && editTrigger.current) {
      editTrigger.current.focus();
      returnToEdit.current = false;
    }
  }, [editing, result?.version]);
  const evidence = useMeetingFinalEvidence(
    userId,
    session.id,
    reference?.segment_id,
    result?.version,
    reference?.revision,
  );
  const labels = {
    not_requested: 'com_meeting_finalization_not_requested',
    queued: 'com_meeting_final_queued',
    running: 'com_meeting_final_running',
    failed: 'com_meeting_final_failed',
    incomplete: 'com_meeting_final_incomplete',
    completed: 'com_meeting_final_completed',
  } as const;
  const canFinalize = ['stopped', 'interrupted', 'failed'].includes(session.capture_state);
  const draftLabel =
    result?.change_kind === 'correction'
      ? 'com_meeting_review_corrected_draft'
      : 'com_meeting_final_draft';
  const latest = result?.version === status.data?.latest_version;
  const reloadLatest = () => {
    setEditing(null);
    setReference(null);
    setVersion(undefined);
    reviewId.current = null;
    review.reset();
    void status.refetch();
  };
  const show = (refs: Reference[]) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((value) => (
        <Button
          key={value.segment_id + ':' + value.revision}
          variant="outline"
          size="sm"
          aria-controls={reference ? evidenceId : undefined}
          aria-expanded={
            reference?.segment_id === value.segment_id && reference?.revision === value.revision
          }
          onClick={(event) => {
            evidenceTrigger.current = event.currentTarget;
            setReference(value);
            evidencePanel.current?.focus();
          }}
        >
          {localize('com_meeting_final_source', {
            position:
              (result?.transcript.findIndex((item) => item.id === value.segment_id) ?? -1) + 1,
            revision: value.revision,
          })}
        </Button>
      ))}
    </div>
  );
  const sections = [
    ['summary', 'com_meeting_final_summary'],
    ['decisions', 'com_meeting_final_decisions'],
    ['unresolved', 'com_meeting_final_unresolved'],
  ] as const;
  return (
    <section className="flex flex-col gap-5" aria-label={localize('com_meeting_final_title')}>
      <h3 className="text-lg font-semibold">{localize('com_meeting_final_title')}</h3>
      {status.isLoading ? (
        <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
      ) : null}
      {!status.isError && status.data ? (
        <p
          role="status"
          aria-live="polite"
          className="bg-surface-secondary rounded-lg p-4 text-sm leading-6 font-medium"
        >
          {localize(
            status.data.state === 'completed' && result?.review_state === 'reviewed'
              ? 'com_meeting_review_completed'
              : labels[status.data.state],
          )}
        </p>
      ) : null}
      {status.isError ? (
        <div role="alert">
          <p>{localize('com_meeting_final_load_error')}</p>
          <Button variant="outline" onClick={() => status.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      ) : null}
      {!status.isError && status.data?.state === 'not_requested' ? (
        <>
          <p className="text-text-secondary">{localize('com_meeting_final_stop_first')}</p>
          <Button
            disabled={!canFinalize || finalize.isLoading}
            onClick={async () => {
              await audio.stopAll();
              requestId.current ??= crypto.randomUUID();
              finalize.mutate({ id: session.id, request_id: requestId.current });
            }}
          >
            {localize('com_meeting_final_start')}
          </Button>
        </>
      ) : null}
      {status.data?.can_retry && !status.isError ? (
        <Button
          variant="outline"
          disabled={retry.isLoading}
          onClick={() => {
            retryId.current ??= crypto.randomUUID();
            retry.mutate(
              { id: session.id, request_id: retryId.current },
              {
                onSuccess: () => {
                  retryId.current = null;
                },
              },
            );
          }}
        >
          {localize('com_meeting_final_retry')}
        </Button>
      ) : null}
      {finalize.isError || retry.isError ? (
        <p role="alert">{localize('com_meeting_final_request_error')}</p>
      ) : null}
      {status.data?.stage === 'uncertain' && !status.isError ? (
        <p role="alert" className="border-border-heavy rounded-lg border p-4 text-sm leading-6">
          {localize('com_meeting_final_uncertain')}
        </p>
      ) : null}
      {result && result.incomplete_reasons.length > 0 ? (
        <p role="alert" className="border-border-heavy rounded-lg border p-4 text-sm leading-6">
          {localize('com_meeting_final_gaps')}
        </p>
      ) : null}
      {notice != null ? (
        <p ref={noticePanel} tabIndex={-1} role="status" className="focus-visible:outline">
          {localize('com_meeting_review_saved', { version: notice })}
        </p>
      ) : null}
      {result ? (
        <>
          <div className="flex max-w-sm flex-col gap-2">
            <label className="text-sm font-semibold" htmlFor={'result-version-' + session.id}>
              {localize('com_meeting_review_version')}
            </label>
            <select
              id={'result-version-' + session.id}
              value={version ?? 'latest'}
              disabled={!!editing || review.isLoading}
              className="border-border-heavy bg-surface-primary text-text-primary w-full rounded-lg border p-2"
              onChange={(event) => {
                setReference(null);
                setNotice(null);
                reviewId.current = null;
                review.reset();
                setVersion(
                  event.target.value === 'latest' ? undefined : Number(event.target.value),
                );
              }}
            >
              <option value="latest">{localize('com_meeting_review_latest')}</option>
              {status.data?.versions?.map((value) => (
                <option key={value.version} value={value.version}>
                  {localize(
                    value.review_state === 'reviewed'
                      ? 'com_meeting_review_history_reviewed'
                      : 'com_meeting_review_history_draft',
                    { version: value.version },
                  )}
                </option>
              ))}
            </select>
          </div>
          <p className="text-text-secondary">
            {localize(
              result.review_state === 'reviewed' ? 'com_meeting_review_reviewed' : draftLabel,
              { version: result.version },
            )}
          </p>
          {result.actor_id ? (
            <p className="text-text-secondary text-sm break-words">
              {localize('com_meeting_review_actor', {
                actor: result.actor_label || localize('com_meeting_review_actor_unavailable'),
                time: new Date(result.acted_at).toLocaleString(),
              })}
            </p>
          ) : null}
          <details className="text-text-secondary text-sm">
            <summary className="min-h-9 cursor-pointer font-medium">
              {localize('com_meeting_review_guidance')}
            </summary>
            <div className="max-w-prose space-y-2 leading-6">
              <p>{localize('com_meeting_review_scope')}</p>
              <p>{localize('com_meeting_timing_precision')}</p>
            </div>
          </details>
          {latest && !editing ? (
            <div className="flex flex-wrap gap-2">
              <Button
                ref={editTrigger}
                variant="outline"
                disabled={review.isLoading}
                onClick={() => {
                  setReference(null);
                  setNotice(null);
                  setEditing(result);
                }}
              >
                {localize('com_meeting_review_edit')}
              </Button>
              {result.review_state !== 'reviewed' ? (
                <Button
                  disabled={review.isLoading}
                  onClick={() => {
                    reviewId.current ??= crypto.randomUUID();
                    review.mutate(
                      {
                        id: session.id,
                        request_id: reviewId.current,
                        expected_version: result.version,
                      },
                      {
                        onSuccess: (value) => {
                          if (value.result) {
                            setVersion(value.result.version);
                            setNotice(value.result.version);
                          }
                          reviewId.current = null;
                        },
                      },
                    );
                  }}
                >
                  {localize('com_meeting_review_mark')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {!latest && !editing ? (
            <p className="text-text-secondary">{localize('com_meeting_review_historical')}</p>
          ) : null}
          {review.isLoading ? (
            <Spinner className="size-5" aria-label={localize('com_meeting_review_saving')} />
          ) : null}
          {review.isError ? (
            <div role="alert" className="flex flex-col gap-2">
              <p>
                {localize(
                  resultConflict(review.error)
                    ? 'com_meeting_review_conflict'
                    : 'com_meeting_review_save_error',
                )}
              </p>
              {resultConflict(review.error) ? (
                <Button variant="outline" onClick={reloadLatest}>
                  {localize('com_meeting_review_reload')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <details className="text-text-secondary text-sm">
            <summary className="cursor-pointer">{localize('com_meeting_result_details')}</summary>
            {result.actor_id ? (
              <p className="break-all">
                {localize('com_meeting_actor_id', { id: result.actor_id })}
              </p>
            ) : null}
            <p className="break-all">
              {localize('com_meeting_final_revision', { revision: result.source_revision })}
            </p>
          </details>
          {!result.generated ? (
            <p className="bg-surface-secondary text-text-secondary rounded-lg p-4 text-sm leading-6">
              {localize('com_meeting_final_no_ai')}
            </p>
          ) : null}
          {editing ? (
            <ResultEditor
              key={editing.version}
              result={editing}
              meetingId={session.id}
              userId={userId}
              onSaved={(savedVersion) => {
                setEditing(null);
                setReference(null);
                setVersion(savedVersion);
                setNotice(savedVersion);
              }}
              onCancel={() => {
                returnToEdit.current = true;
                setEditing(null);
              }}
              onReload={reloadLatest}
            />
          ) : (
            <>
              {result.generated &&
                sections.map(([kind, label]) => (
                  <section key={kind} aria-label={localize(label)}>
                    <h4 className="font-semibold">{localize(label)}</h4>
                    {!result[kind].length ? (
                      <p className="text-text-secondary">{localize('com_meeting_final_none')}</p>
                    ) : null}
                    <ul className="flex flex-col gap-3">
                      {result[kind].map((item, index) => (
                        <li key={index} className="mt-2">
                          <p className="break-words whitespace-pre-wrap">{item.text}</p>
                          {item.human_corrected ? (
                            <p className="text-text-secondary text-sm">
                              {localize('com_meeting_review_human_item')}
                            </p>
                          ) : null}
                          {show(item.citations)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              {result.generated ? (
                <section aria-label={localize('com_meeting_final_actions')}>
                  <h4 className="font-semibold">{localize('com_meeting_final_actions')}</h4>
                  {!result.actions.length ? (
                    <p className="text-text-secondary">{localize('com_meeting_final_none')}</p>
                  ) : null}
                  <ul className="flex flex-col gap-3">
                    {result.actions.map((item, index) => (
                      <li key={index} className="mt-2">
                        <p className="break-words whitespace-pre-wrap">{item.text}</p>
                        {item.human_corrected ? (
                          <p className="text-text-secondary text-sm">
                            {localize('com_meeting_review_human_item')}
                          </p>
                        ) : null}
                        <p className="text-text-secondary mt-1 break-words">
                          {localize('com_meeting_final_owner', {
                            value: item.owner?.trim() || localize('com_meeting_final_unknown'),
                          })}
                        </p>
                        <p className="text-text-secondary break-words">
                          {localize('com_meeting_final_due', {
                            value: item.due_date?.trim() || localize('com_meeting_final_unknown'),
                          })}
                        </p>
                        {show(item.citations)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {result.unknowns.length ? (
                <ul className="text-text-secondary flex flex-col gap-2">
                  {result.unknowns.map((value, index) => (
                    <li key={index} className="break-words whitespace-pre-wrap">
                      {value}
                    </li>
                  ))}
                </ul>
              ) : null}
              <details className="border-border-light border-t pt-4">
                <summary className="min-h-9 cursor-pointer text-sm font-semibold focus-visible:outline">
                  {localize('com_meeting_final_transcript')}
                </summary>
                <ol className="mt-3 flex flex-col gap-3">
                  {result.transcript.map((value) => (
                    <li key={value.id} className="border-border-light rounded-lg border p-3">
                      <p className="text-text-secondary text-sm">
                        {formatMeetingTime(value.start_ms)}–{formatMeetingTime(value.end_ms)} ·{' '}
                        {localize('com_meeting_final_segment_revision', {
                          revision: value.revision,
                        })}
                      </p>
                      <p className="text-text-secondary text-sm">
                        {value.speaker ?? localize('com_meeting_speaker_unknown')} ·{' '}
                        {localize(
                          value.time_precision === 'provider'
                            ? 'com_meeting_review_timing_passage'
                            : 'com_meeting_review_timing_capture',
                        )}
                      </p>
                      <p className="mt-2 break-words whitespace-pre-wrap">{value.text}</p>
                      {value.human_corrected ? (
                        <p className="text-text-secondary text-sm">
                          {localize('com_meeting_review_human_transcript')}
                        </p>
                      ) : null}
                      {show([{ segment_id: value.id, revision: value.revision }])}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
          {!editing ? (
            <details className="border-border-light border-t pt-4">
              <summary className="min-h-9 cursor-pointer text-sm font-semibold focus-visible:outline">
                {localize('com_meeting_sharing')}
              </summary>
              <div className="mt-3">
                <SharingPanel meetingId={session.id} userId={userId} version={result.version} />
              </div>
            </details>
          ) : null}
        </>
      ) : null}
      {reference && result ? (
        <aside
          ref={evidencePanel}
          id={evidenceId}
          tabIndex={-1}
          aria-live="polite"
          className="border-border-light rounded-lg border p-3 focus-visible:outline"
          aria-label={localize('com_meeting_final_evidence')}
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">{localize('com_meeting_final_evidence')}</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReference(null);
                evidenceTrigger.current?.focus();
              }}
            >
              {localize('com_meeting_final_close_evidence')}
            </Button>
          </div>
          {evidence.isLoading ? (
            <Spinner className="mt-2 size-5" aria-label={localize('com_ui_loading')} />
          ) : null}
          {evidence.isError ? (
            <p role="alert">{localize('com_meeting_final_evidence_unavailable')}</p>
          ) : null}
          {evidence.data && !evidence.isError ? (
            <>
              <p className="text-text-secondary mt-2 text-sm">
                {formatMeetingTime(evidence.data.segment.start_ms)}–
                {formatMeetingTime(evidence.data.segment.end_ms)} ·{' '}
                {localize('com_meeting_final_segment_revision', {
                  revision: evidence.data.segment.revision,
                })}
              </p>
              <p className="text-text-secondary mt-2 text-sm">
                {evidence.data.segment.speaker ?? localize('com_meeting_speaker_unknown')} ·{' '}
                {localize(
                  evidence.data.segment.time_precision === 'provider'
                    ? 'com_meeting_review_timing_passage'
                    : 'com_meeting_review_timing_capture',
                )}
              </p>
              <p className="mt-2 break-words whitespace-pre-wrap">{evidence.data.segment.text}</p>
              {evidence.data.segment.human_corrected ? (
                <p className="text-text-secondary text-sm">
                  {localize('com_meeting_review_human_transcript')}
                </p>
              ) : null}
            </>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
