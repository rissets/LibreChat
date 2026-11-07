import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, Input, Spinner } from '@librechat/client';
import type { TMeetingCorrectionInput, TMeetingFinalResult } from 'librechat-data-provider';
import { useCorrectMeetingResult } from '~/data-provider/Meetings';
import { useLocalize } from '~/hooks';

type Fact = TMeetingCorrectionInput['facts'][number];
const sections = [
  ['summary', 'com_meeting_final_summary'],
  ['decisions', 'com_meeting_final_decisions'],
  ['unresolved', 'com_meeting_final_unresolved'],
  ['actions', 'com_meeting_final_actions'],
] as const;

export function resultConflict(error: unknown) {
  return (
    isAxiosError<{ code?: string }>(error) &&
    error.response?.status === 409 &&
    ['MEETING_RESULT_VERSION_CONFLICT', 'MEETING_RESULT_ALREADY_REVIEWED'].includes(
      error.response.data.code ?? '',
    )
  );
}

export default function ResultEditor({
  result,
  meetingId,
  userId,
  onSaved,
  onCancel,
  onReload,
}: {
  result: TMeetingFinalResult;
  meetingId: string;
  userId?: string;
  onSaved: (version: number) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const localize = useLocalize();
  const save = useCorrectMeetingResult(userId, meetingId);
  const firstField = useRef<HTMLTextAreaElement | null>(null);
  const delivery = useRef<TMeetingCorrectionInput | null>(null);
  const [segments, setSegments] = useState(() =>
    result.transcript.map((value) => ({
      id: value.id,
      expected_revision: value.revision,
      text: value.text,
      speaker: value.speaker ?? '',
    })),
  );
  const [facts, setFacts] = useState<Fact[]>(() =>
    sections.flatMap(([section]) =>
      result[section].map((value, index) => ({
        section,
        index,
        text: value.text,
        ...('owner' in value ? { owner: value.owner, due_date: value.due_date } : {}),
      })),
    ),
  );
  useEffect(() => firstField.current?.focus(), []);
  const changedSegments = segments.flatMap((value, index) => {
    const original = result.transcript[index];
    const speaker = value.speaker.trim() || null;
    return value.text.trim() === original.text && speaker === original.speaker
      ? []
      : [{ ...value, text: value.text.trim(), speaker }];
  });
  const changedFacts = facts.flatMap((value) => {
    const original = result[value.section][value.index];
    const normalized = {
      ...value,
      text: value.text.trim(),
      ...(value.section === 'actions'
        ? { owner: value.owner?.trim() || null, due_date: value.due_date?.trim() || null }
        : {}),
    };
    const changed =
      normalized.text !== original.text ||
      ('owner' in original &&
        (normalized.owner !== original.owner || normalized.due_date !== original.due_date));
    return changed ? [normalized] : [];
  });
  const updateFact = (position: number, update: Partial<Fact>) => {
    delivery.current = null;
    setFacts((values) =>
      values.map((value, index) => (index === position ? { ...value, ...update } : value)),
    );
  };
  const valid =
    changedSegments.every((value) => value.text) && changedFacts.every((value) => value.text);
  return (
    <form
      aria-label={localize('com_meeting_review_editor')}
      className="border-border-heavy flex flex-col gap-5 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        delivery.current ??= {
          request_id: crypto.randomUUID(),
          expected_version: result.version,
          segments: changedSegments,
          facts: changedFacts,
        };
        save.mutate(
          { id: meetingId, ...delivery.current },
          {
            onSuccess: (value) => {
              if (value.result) onSaved(value.result.version);
            },
          },
        );
      }}
    >
      <h4 className="font-semibold">{localize('com_meeting_review_editor')}</h4>
      <p className="text-text-secondary">
        {localize('com_meeting_review_editing_version', { version: result.version })}
      </p>
      <p className="text-text-secondary">{localize('com_meeting_review_edit_help')}</p>
      {segments.map((value, index) => (
        <fieldset key={value.id} className="flex min-w-0 flex-col gap-2" disabled={save.isLoading}>
          <legend className="mb-2 font-semibold">
            {localize('com_meeting_review_passage', { position: index + 1 })}
          </legend>
          <label htmlFor={'review-text-' + value.id}>
            {localize('com_meeting_review_transcript_text', { position: index + 1 })}
          </label>
          <textarea
            ref={index === 0 ? firstField : undefined}
            id={'review-text-' + value.id}
            rows={3}
            required
            maxLength={50000}
            value={value.text}
            className="border-border-heavy bg-surface-primary text-text-primary focus-visible:outline-border-heavy w-full rounded-lg border p-3 focus-visible:outline focus-visible:outline-2"
            onChange={(event) => {
              delivery.current = null;
              setSegments((values) =>
                values.map((item, position) =>
                  position === index ? { ...item, text: event.target.value } : item,
                ),
              );
            }}
          />
          <label htmlFor={'review-speaker-' + value.id}>
            {localize('com_meeting_review_speaker', { position: index + 1 })}
          </label>
          <Input
            id={'review-speaker-' + value.id}
            maxLength={100}
            value={value.speaker}
            onChange={(event) => {
              delivery.current = null;
              setSegments((values) =>
                values.map((item, position) =>
                  position === index ? { ...item, speaker: event.target.value } : item,
                ),
              );
            }}
          />
        </fieldset>
      ))}
      {facts.map((value, position) => {
        const label = sections.find(([section]) => section === value.section)![1];
        const id = `review-${meetingId}-${value.section}-${value.index}`;
        return (
          <fieldset key={id} className="flex min-w-0 flex-col gap-2" disabled={save.isLoading}>
            <legend className="mb-2 font-semibold">
              {localize(label)} · {value.index + 1}
            </legend>
            <label htmlFor={id}>
              {localize('com_meeting_review_item_text', {
                section: localize(label),
                position: value.index + 1,
              })}
            </label>
            <textarea
              id={id}
              rows={3}
              required
              maxLength={4000}
              value={value.text}
              className="border-border-heavy bg-surface-primary text-text-primary focus-visible:outline-border-heavy w-full rounded-lg border p-3 focus-visible:outline focus-visible:outline-2"
              onChange={(event) => updateFact(position, { text: event.target.value })}
            />
            {value.section === 'actions' ? (
              <>
                <label htmlFor={id + '-owner'}>
                  {localize('com_meeting_review_action_owner', { position: value.index + 1 })}
                </label>
                <Input
                  id={id + '-owner'}
                  maxLength={200}
                  value={value.owner ?? ''}
                  onChange={(event) => updateFact(position, { owner: event.target.value })}
                />
                <label htmlFor={id + '-due'}>
                  {localize('com_meeting_review_action_due', { position: value.index + 1 })}
                </label>
                <Input
                  id={id + '-due'}
                  maxLength={100}
                  value={value.due_date ?? ''}
                  onChange={(event) => updateFact(position, { due_date: event.target.value })}
                />
              </>
            ) : null}
          </fieldset>
        );
      })}
      {save.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>
            {localize(
              resultConflict(save.error)
                ? 'com_meeting_review_conflict'
                : 'com_meeting_review_save_error',
            )}
          </p>
          {resultConflict(save.error) ? (
            <Button type="button" variant="outline" onClick={onReload}>
              {localize('com_meeting_review_reload')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {save.isLoading ? (
        <Spinner className="size-5" aria-label={localize('com_meeting_review_saving')} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={save.isLoading || !valid || (!changedSegments.length && !changedFacts.length)}
        >
          {localize('com_meeting_review_save')}
        </Button>
        <Button type="button" variant="outline" disabled={save.isLoading} onClick={onCancel}>
          {localize('com_meeting_review_cancel')}
        </Button>
      </div>
    </form>
  );
}
