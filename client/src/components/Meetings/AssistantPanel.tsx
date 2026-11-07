import { useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, Spinner } from '@librechat/client';
import type {
  TMeetingAssistant,
  TMeetingAssistantInput,
  TMeetingCitation,
} from 'librechat-data-provider';
import type { MeetingMicrophone } from './capture';
import {
  useAskMeetingAssistant,
  useMeetingAssistant,
  useMeetingEvidence,
  useMeetingTranscript,
} from '~/data-provider/Meetings';
import { meetingLimitError } from './limit-errors';
import { SpeechPanel } from './SpeechPanel';
import SharingPanel from './SharingPanel';
import { VoicePanel } from './VoicePanel';
import { useLocalize } from '~/hooks';

/** Generated text is plain text. Only these authenticated internal evidence controls can navigate. */
export function AssistantPanel({
  meetingId,
  userId,
  microphone,
  captureActive = false,
}: {
  meetingId: string;
  userId?: string;
  microphone: MeetingMicrophone;
  captureActive?: boolean;
}) {
  const localize = useLocalize();
  const history = useMeetingAssistant(userId, meetingId);
  const transcript = useMeetingTranscript(userId, meetingId);
  const ask = useAskMeetingAssistant(userId, meetingId);
  const postmeeting = ['stopped', 'failed'].includes(transcript.data?.capture?.state ?? '');
  let errorLabel = localize('com_meeting_assistant_delivery');
  if (meetingLimitError(ask.error) === 'concurrency') {
    errorLabel = localize('com_meeting_concurrency_full');
  } else if (isAxiosError(ask.error) && [401, 403].includes(ask.error.response?.status ?? 0)) {
    errorLabel = localize('com_meeting_denied');
  }
  const [question, setQuestion] = useState('');
  const [delivery, setDelivery] = useState<TMeetingAssistantInput | null>(null);
  const [reference, setReference] = useState<(TMeetingCitation & { operationId: string }) | null>(
    null,
  );
  const evidence = useMeetingEvidence(
    userId,
    meetingId,
    reference?.operationId,
    reference?.segment_id,
    reference?.revision,
  );
  const send = (purpose: 'answer' | 'summary') => {
    const body = delivery ?? {
      operation_id: crypto.randomUUID(),
      purpose,
      question: purpose === 'answer' ? question.trim() : '',
    };
    setDelivery(body);
    ask.mutate(
      { id: meetingId, ...body },
      {
        onSuccess: () => {
          setDelivery(null);
          if (purpose === 'answer') setQuestion('');
        },
      },
    );
  };
  const citations = (operation: TMeetingAssistant, values: TMeetingCitation[]) => (
    <span className="flex flex-wrap gap-2">
      {values.map((value, index) => (
        <Button
          key={value.segment_id + ':' + value.revision}
          variant="outline"
          size="sm"
          onClick={() => setReference({ ...value, operationId: operation.id })}
        >
          {localize('com_meeting_evidence')} {index + 1} · {localize('com_meeting_revision')}{' '}
          {value.revision}
        </Button>
      ))}
    </span>
  );
  const failureLabel = (operation: TMeetingAssistant) => {
    if (operation.state === 'cancelled') return localize('com_meeting_voice_cancelled');
    if (['accepted', 'processing'].includes(operation.state))
      return localize('com_meeting_assistant_pending');
    if (operation.error_code === 'MEETING_CONCURRENCY_LIMIT')
      return localize('com_meeting_concurrency_full');
    if (['MEETING_ACCESS_DENIED', 'MEETING_IDENTITY_DENIED'].includes(operation.error_code ?? ''))
      return localize('com_meeting_denied');
    return localize(
      operation.state === 'rejected'
        ? 'com_meeting_assistant_rejected'
        : 'com_meeting_assistant_uncertain',
    );
  };
  return (
    <section
      aria-label={localize('com_meeting_assistant')}
      className="border-border-medium text-text-primary flex flex-col gap-4 rounded-lg border p-4"
    >
      <h3 className="text-lg font-semibold">{localize('com_meeting_assistant')}</h3>
      <p className="text-text-secondary">{localize('com_meeting_assistant_scope')}</p>
      <VoicePanel meetingId={meetingId} userId={userId} microphone={microphone} />
      <p role="status">
        {localize(
          postmeeting ? 'com_meeting_assistant_postmeeting' : 'com_meeting_assistant_live_limits',
        )}
      </p>
      <Button
        variant="outline"
        className="self-start"
        disabled={ask.isLoading || !!delivery}
        onClick={() => send('summary')}
      >
        {localize('com_meeting_summary_update')}
      </Button>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send('answer');
        }}
      >
        <label htmlFor="meeting-question">{localize('com_meeting_question')}</label>
        <textarea
          id="meeting-question"
          rows={3}
          maxLength={2000}
          value={question}
          className="border-border-heavy bg-surface-primary text-text-primary focus-visible:outline-border-heavy w-full rounded-lg border p-3 focus-visible:outline focus-visible:outline-2"
          onChange={(event) => setQuestion(event.target.value)}
          disabled={ask.isLoading || !!delivery}
        />
        <Button
          type="submit"
          className="self-start"
          disabled={!question.trim() || ask.isLoading || !!delivery}
        >
          {localize('com_meeting_question_send')}
        </Button>
      </form>
      {ask.isLoading && (
        <div role="status" className="flex items-center gap-2">
          <Spinner className="size-4" />
          {localize('com_meeting_assistant_pending')}
        </div>
      )}
      {ask.isError && (
        <div role="alert">
          <p>{errorLabel}</p>
          <Button variant="outline" onClick={() => send(delivery?.purpose ?? 'answer')}>
            {localize('com_meeting_delivery_retry')}
          </Button>
        </div>
      )}
      {history.isLoading && <p role="status">{localize('com_ui_loading')}</p>}
      {history.isError ? (
        <div role="alert">
          <p>{localize('com_meeting_unavailable')}</p>
          <Button variant="outline" onClick={() => history.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {history.data?.operations.map((operation) => (
            <li
              key={operation.id}
              className="border-border-medium flex flex-col gap-2 border-t pt-4"
            >
              <h4 className="font-semibold">
                {operation.purpose === 'summary'
                  ? localize('com_meeting_summary')
                  : operation.question || localize('com_meeting_voice')}
              </h4>
              {operation.input_kind === 'voice' && (
                <p className="text-text-secondary text-sm">
                  {localize('com_meeting_voice_interaction')}
                </p>
              )}
              {['live', 'postmeeting'].includes(operation.provenance.context_phase ?? '') && (
                <p className="text-text-secondary text-sm">
                  {localize(
                    operation.provenance.context_phase === 'postmeeting'
                      ? 'com_meeting_operation_postmeeting'
                      : 'com_meeting_operation_live',
                  )}
                </p>
              )}
              <p className="text-text-secondary text-sm break-words">
                {localize('com_meeting_context_revision')}:{' '}
                {operation.context_revision.slice(0, 12)} ·{' '}
                {localize('com_meeting_context_through', {
                  0: Math.ceil(operation.context_end_ms / 1000),
                  1: operation.context_segment_count,
                })}
              </p>
              {operation.purpose === 'summary' &&
                transcript.data &&
                operation.context_revision !== transcript.data.context_revision && (
                  <p role="status">{localize('com_meeting_summary_older')}</p>
                )}
              {operation.state !== 'completed' && <p role="status">{failureLabel(operation)}</p>}
              {operation.content && (
                <>
                  {operation.content.answer && (
                    <p className="break-words whitespace-pre-wrap">{operation.content.answer}</p>
                  )}
                  {citations(operation, operation.content.citations)}
                  {(['summary', 'decisions', 'unresolved', 'actions'] as const).map(
                    (kind) =>
                      operation.content![kind].length > 0 && (
                        <div key={kind} className="flex flex-col gap-2">
                          <h5 className="font-semibold">
                            {localize(`com_meeting_result_${kind}`)}
                          </h5>
                          <ul className="flex flex-col gap-3">
                            {operation.content![kind].map((fact, index) => (
                              <li key={index}>
                                <p className="break-words whitespace-pre-wrap">{fact.text}</p>
                                {'owner' in fact && (
                                  <p className="text-text-secondary">
                                    {localize('com_meeting_action_owner')}:{' '}
                                    {fact.owner ?? localize('com_meeting_unknown')} ·{' '}
                                    {localize('com_meeting_action_due')}:{' '}
                                    {fact.due_date ?? localize('com_meeting_unknown')}
                                  </p>
                                )}
                                {citations(operation, fact.citations)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ),
                  )}
                  {operation.content.unknowns.map((value, index) => (
                    <p key={index} className="break-words whitespace-pre-wrap">
                      {value}
                    </p>
                  ))}
                  {operation.state === 'completed' &&
                    operation.purpose === 'answer' &&
                    operation.content.answer && (
                      <>
                        <SpeechPanel
                          meetingId={meetingId}
                          answerId={operation.id}
                          answerText={operation.content.answer}
                          captureActive={captureActive}
                          userId={userId}
                        />
                        <SharingPanel
                          meetingId={meetingId}
                          userId={userId}
                          version={1}
                          artifact={{ kind: 'saved_answer', id: operation.id }}
                        />
                      </>
                    )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {history.data?.operations.length === 0 && <p>{localize('com_meeting_assistant_empty')}</p>}
      {reference && (
        <aside
          aria-label={localize('com_meeting_evidence')}
          className="border-border-heavy flex flex-col gap-2 rounded-lg border p-3"
          tabIndex={-1}
        >
          <h4 className="font-semibold">
            {localize('com_meeting_evidence')} · {localize('com_meeting_revision')}{' '}
            {reference.revision}
          </h4>
          {evidence.isLoading && <p role="status">{localize('com_ui_loading')}</p>}
          {evidence.isError && <p role="alert">{localize('com_meeting_unavailable')}</p>}
          {evidence.data && !evidence.isError && (
            <>
              <p className="break-words whitespace-pre-wrap">{evidence.data.segment.text}</p>
              {evidence.data.segment.human_corrected ? (
                <p className="text-text-secondary text-sm">
                  {localize('com_meeting_review_human_transcript')}
                </p>
              ) : null}
              <p className="text-text-secondary text-sm">
                {localize('com_meeting_evidence_seconds', {
                  0: Math.floor(evidence.data.segment.start_ms / 1000),
                  1: Math.ceil(evidence.data.segment.end_ms / 1000),
                })}{' '}
                · {localize('com_meeting_context_revision')}:{' '}
                {evidence.data.context_revision.slice(0, 12)}
              </p>
            </>
          )}
          <Button variant="outline" className="self-start" onClick={() => setReference(null)}>
            {localize('com_meeting_evidence_close')}
          </Button>
        </aside>
      )}
    </section>
  );
}
