import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { Share2, ChevronRight } from 'lucide-react';
import type { TMeetingFinalResult } from 'librechat-data-provider';
import {
  useSharedMeetingArtifacts,
  useSharedMeetingEvidence,
  useSharedMeetingResult,
  useSharedMeetingAnswer,
  useSharedMeetingAnswerEvidence,
} from '~/data-provider/Meetings/sharing';
import { sectionLabels } from './sharingLabels';
import { MeetingAudioSession } from './audio';
import { SpeechPanel } from './SpeechPanel';
import { useLocalize } from '~/hooks';

type Reference = TMeetingFinalResult['summary'][number]['citations'][number];

export function SharedMeetingList({ userId, enabled }: { userId?: string; enabled: boolean }) {
  const localize = useLocalize();
  const results = useSharedMeetingArtifacts(userId, enabled);
  return (
    <section className="flex flex-col gap-3" aria-label={localize('com_meeting_shared_with_me')}>
      <h2 className="text-lg font-semibold">{localize('com_meeting_shared_with_me')}</h2>
      {results.isLoading ? (
        <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
      ) : null}
      {results.isError ? (
        <div role="alert">
          <p>{localize('com_meeting_error')}</p>
          <Button variant="outline" onClick={() => results.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      ) : null}
      {results.data?.artifacts.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_meeting_shared_empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-2.5">
        {results.data && !results.isError
          ? results.data.artifacts.map((value) => (
              <li
                key={
                  value.meeting_id + ':' + value.kind + ':' + (value.artifact_id ?? value.version)
                }
              >
                <Link
                  className="group border-border-light hover:border-primary/40 hover:bg-surface-secondary/70 focus-visible:ring-primary flex items-center justify-between gap-4 rounded-xl border p-4 break-words transition-all duration-150 focus-visible:outline-none focus-visible:ring-2"
                  to={
                    '/meetings/' +
                    value.meeting_id +
                    (value.kind === 'saved_answer'
                      ? '?sharedAnswer=' + value.artifact_id
                      : '?sharedVersion=' + value.version)
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="bg-surface-tertiary text-primary flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-light">
                      <Share2 className="size-4" aria-hidden="true" />
                    </div>
                    <span className="truncate text-sm font-semibold group-hover:text-primary transition-colors">
                      {value.title} ·{' '}
                      {value.kind === 'saved_answer'
                        ? localize('com_meeting_shared_answer')
                        : localize('com_meeting_shared_version', { version: value.version })}
                    </span>
                  </div>
                  <ChevronRight className="text-text-secondary group-hover:text-primary size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))
          : null}
      </ul>
    </section>
  );
}

export function SharedMeetingAnswer({
  userId,
  meetingId,
  answerId,
}: {
  userId?: string;
  meetingId: string;
  answerId: string;
}) {
  const localize = useLocalize();
  const answer = useSharedMeetingAnswer(userId, meetingId, answerId);
  const [reference, setReference] = useState<Reference | null>(null);
  const evidence = useSharedMeetingAnswerEvidence(
    userId,
    meetingId,
    answerId,
    reference?.segment_id,
    reference?.revision,
  );
  const value = !answer.isError ? answer.data : undefined;
  return (
    <section aria-label={localize('com_meeting_shared_answer')} className="flex flex-col gap-4">
      <Link to="/meetings" className="text-text-secondary underline">
        {localize('com_meeting_back')}
      </Link>
      <p className="text-text-secondary">{localize('com_meeting_shared_readonly')}</p>
      {answer.isLoading && <Spinner className="size-5" aria-label={localize('com_ui_loading')} />}
      {answer.isError && <p role="alert">{localize('com_meeting_shared_unavailable')}</p>}
      {value && (
        <>
          <h2 className="text-xl font-semibold">{localize('com_meeting_shared_answer')}</h2>
          <p className="break-words whitespace-pre-wrap">{value.content.answer}</p>
          {value.evidence_allowed && (
            <div className="flex flex-wrap gap-2">
              {value.content.citations.map((cite, index) => (
                <Button
                  variant="outline"
                  key={cite.segment_id + ':' + cite.revision}
                  onClick={() => setReference(cite)}
                >
                  {localize('com_meeting_final_source', {
                    position: index + 1,
                    revision: cite.revision,
                  })}
                </Button>
              ))}
            </div>
          )}
          {reference && (
            <aside
              aria-label={localize('com_meeting_final_evidence')}
              className="border-border-light rounded-lg border p-3"
            >
              <Button variant="outline" onClick={() => setReference(null)}>
                {localize('com_meeting_final_close_evidence')}
              </Button>
              {evidence.isError && (
                <p role="alert">{localize('com_meeting_final_evidence_unavailable')}</p>
              )}
              {evidence.data && !evidence.isError && (
                <p className="break-words whitespace-pre-wrap">{evidence.data.segment.text}</p>
              )}
            </aside>
          )}
          {value.speech_allowed && (
            <MeetingAudioSession>
              <SpeechPanel
                readOnly
                meetingId={meetingId}
                answerId={answerId}
                answerText={value.content.answer}
                userId={userId}
              />
            </MeetingAudioSession>
          )}
        </>
      )}
    </section>
  );
}

export function SharedMeetingResult({
  userId,
  meetingId,
  version,
}: {
  userId?: string;
  meetingId: string;
  version: number;
}) {
  const localize = useLocalize();
  const result = useSharedMeetingResult(userId, meetingId, version);
  const [reference, setReference] = useState<Reference | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const evidence = useSharedMeetingEvidence(
    userId,
    meetingId,
    version,
    reference?.segment_id,
    reference?.revision,
  );
  const value = !result.isError ? result.data : undefined;
  const draftLabel =
    value?.change_kind === 'correction'
      ? 'com_meeting_review_shared_draft'
      : 'com_meeting_shared_draft';
  useEffect(() => {
    if (reference) panel.current?.focus();
  }, [reference]);
  const citations = (refs: Reference[]) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((cite, index) => (
        <Button
          key={cite.segment_id + ':' + cite.revision}
          variant="outline"
          size="sm"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setReference(cite);
          }}
        >
          {localize('com_meeting_final_source', { position: index + 1, revision: cite.revision })}
        </Button>
      ))}
    </div>
  );
  return (
    <section className="flex flex-col gap-4" aria-label={localize('com_meeting_shared_result')}>
      <Link to="/meetings" className="text-text-secondary underline">
        {localize('com_meeting_back')}
      </Link>
      <p className="text-text-secondary">{localize('com_meeting_shared_readonly')}</p>
      <Button
        variant="outline"
        disabled={result.isFetching}
        onClick={() => {
          setReference(null);
          result.refetch();
        }}
      >
        {localize('com_meeting_shared_refresh')}
      </Button>
      {result.isLoading ? (
        <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
      ) : null}
      {result.isError ? <p role="alert">{localize('com_meeting_shared_unavailable')}</p> : null}
      {value ? (
        <>
          <h2 className="text-xl font-semibold break-words">{value.title}</h2>
          <p>
            {localize('com_meeting_shared_version', { version: value.version })} ·{' '}
            {localize(
              value.review_state === 'reviewed' ? 'com_meeting_shared_reviewed' : draftLabel,
            )}
          </p>
          {value.change_kind !== 'generated' ? (
            <p className="text-text-secondary">{localize('com_meeting_review_scope')}</p>
          ) : null}
          {value.completeness === 'incomplete' ? (
            <p role="status">{localize('com_meeting_final_gaps')}</p>
          ) : null}
          {!value.evidence_allowed ? (
            <p className="text-text-secondary">{localize('com_meeting_shared_evidence_off')}</p>
          ) : null}
          {(['summary', 'decisions', 'unresolved', 'actions'] as const).map((kind) =>
            value.sections[kind] ? (
              <section
                key={kind}
                className="border-border-light rounded-xl border p-4"
                aria-label={localize(sectionLabels[kind])}
              >
                <h3 className="font-semibold">{localize(sectionLabels[kind])}</h3>
                {value.sections[kind]?.length === 0 ? (
                  <p className="text-text-secondary">{localize('com_meeting_final_none')}</p>
                ) : null}
                <ul className="mt-3 flex flex-col gap-3">
                  {value.sections[kind]?.map((item, index) => (
                    <li key={index}>
                      <p className="break-words whitespace-pre-wrap">{item.text}</p>
                      {item.human_corrected ? (
                        <p className="text-text-secondary text-sm">
                          {localize('com_meeting_review_human_item')}
                        </p>
                      ) : null}
                      {'owner' in item ? (
                        <p className="text-text-secondary">
                          {localize('com_meeting_final_owner', {
                            value: item.owner?.trim() || localize('com_meeting_final_unknown'),
                          })}
                        </p>
                      ) : null}
                      {'due_date' in item ? (
                        <p className="text-text-secondary">
                          {localize('com_meeting_final_due', {
                            value: item.due_date?.trim() || localize('com_meeting_final_unknown'),
                          })}
                        </p>
                      ) : null}
                      {value.evidence_sections.includes(kind) ? citations(item.citations) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          {value.sections.transcript ? (
            <section
              className="border-border-light rounded-xl border p-4"
              aria-label={localize(sectionLabels.transcript)}
            >
              <h3 className="font-semibold">{localize(sectionLabels.transcript)}</h3>
              <ol className="mt-3 flex flex-col gap-3">
                {value.sections.transcript.map((item) => (
                  <li key={item.id + ':' + item.revision}>
                    <p className="text-text-secondary text-sm">
                      {localize('com_meeting_final_segment_revision', { revision: item.revision })}
                    </p>
                    <p className="break-words whitespace-pre-wrap">{item.text}</p>
                    <p className="text-text-secondary text-sm">
                      {item.speaker ?? localize('com_meeting_speaker_unknown')} ·{' '}
                      {localize(
                        item.time_precision === 'provider'
                          ? 'com_meeting_review_timing_passage'
                          : 'com_meeting_review_timing_capture',
                      )}
                    </p>
                    {item.human_corrected ? (
                      <p className="text-text-secondary text-sm">
                        {localize('com_meeting_review_human_transcript')}
                      </p>
                    ) : null}
                    {value.evidence_sections.includes('transcript')
                      ? citations([{ segment_id: item.id, revision: item.revision }])
                      : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {value.sections.unknowns ? (
            <section aria-label={localize(sectionLabels.unknowns)}>
              <h3 className="font-semibold">{localize(sectionLabels.unknowns)}</h3>
              <ul>
                {value.sections.unknowns.map((item, index) => (
                  <li key={index} className="break-words whitespace-pre-wrap">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {reference ? (
            <aside
              ref={panel}
              tabIndex={-1}
              aria-live="polite"
              aria-label={localize('com_meeting_final_evidence')}
              className="border-border-light rounded-lg border p-3 focus-visible:outline"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{localize('com_meeting_final_evidence')}</h3>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReference(null);
                    trigger.current?.focus();
                  }}
                >
                  {localize('com_meeting_final_close_evidence')}
                </Button>
              </div>
              {evidence.isLoading ? (
                <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
              ) : null}
              {evidence.isError ? (
                <p role="alert">{localize('com_meeting_final_evidence_unavailable')}</p>
              ) : null}
              {evidence.data && !evidence.isError ? (
                <>
                  <p className="mt-3 break-words whitespace-pre-wrap">
                    {evidence.data.segment.text}
                  </p>
                  {evidence.data.segment.human_corrected ? (
                    <p className="text-text-secondary text-sm">
                      {localize('com_meeting_review_human_transcript')}
                    </p>
                  ) : null}
                </>
              ) : null}
            </aside>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
