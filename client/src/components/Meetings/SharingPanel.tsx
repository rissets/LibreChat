import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Spinner } from '@librechat/client';
import type { TMeetingRecipient, TMeetingSharedSection } from 'librechat-data-provider';
import {
  useMeetingRecipients,
  useMeetingShares,
  useRevokeMeetingShare,
  useShareMeeting,
} from '~/data-provider/Meetings/sharing';
import { sectionLabels } from './sharingLabels';
import { useLocalize } from '~/hooks';

export default function SharingPanel({
  meetingId,
  userId,
  version,
  artifact,
}: {
  meetingId: string;
  userId?: string;
  version: number;
  artifact?: { kind: 'saved_answer' | 'speech'; id: string };
}) {
  const localize = useLocalize();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TMeetingRecipient | null>(null);
  const [sections, setSections] = useState<TMeetingSharedSection[]>(['summary']);
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(version);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const revocations = useRef(new Map<string, string>());
  const recipients = useMeetingRecipients(userId, meetingId, search);
  const shares = useMeetingShares(userId, meetingId);
  const share = useShareMeeting(userId, meetingId);
  const revoke = useRevokeMeetingShare(userId, meetingId);
  const busy = share.isLoading || revoke.isLoading;
  const grants = shares.data?.grants.filter((grant) =>
    artifact
      ? grant.artifact_kind === artifact.kind && grant.artifact_id === artifact.id
      : grant.artifact_kind === 'final_result',
  );
  const fieldId = artifact ? 'meeting-recipient-' + artifact.id : 'meeting-recipient-search';
  const mode = artifact?.kind ?? 'final_result';
  const label = {
    speech: 'com_meeting_speech_sharing',
    saved_answer: 'com_meeting_answer_sharing',
    final_result: 'com_meeting_sharing',
  } as const;
  const scopeLabel = {
    speech: 'com_meeting_share_saved_speech',
    saved_answer: 'com_meeting_share_saved_answer',
    final_result: 'com_meeting_sharing_scope',
  } as const;
  return (
    <section
      className="border-border-light flex flex-col gap-4 rounded-xl border p-4"
      aria-label={localize(label[mode])}
    >
      <h3 className="text-lg font-semibold">{localize(label[mode])}</h3>
      <p className="text-text-secondary">{localize(scopeLabel[mode])}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setSelected(null);
        }}
      >
        <label htmlFor={fieldId}>{localize('com_meeting_recipient_search')}</label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={fieldId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={100}
            disabled={busy}
          />
          <Button type="submit" variant="outline" disabled={!query.trim() || busy}>
            {localize('com_meeting_find_recipients')}
          </Button>
        </div>
      </form>
      {recipients.isFetching ? (
        <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
      ) : null}
      {recipients.isError ? <p role="alert">{localize('com_meeting_error')}</p> : null}
      {search &&
      !recipients.isFetching &&
      !recipients.isError &&
      recipients.data?.recipients.length === 0 ? (
        <p role="status">{localize('com_meeting_recipients_empty')}</p>
      ) : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected || !sections.length || busy || selectedVersion < 1) return;
          const body = {
            recipient_kind: selected.kind,
            recipient_id: selected.id,
            artifact_kind: artifact?.kind ?? ('final_result' as const),
            ...(artifact ? { artifact_id: artifact.id } : {}),
            version: artifact ? 1 : selectedVersion,
            sections: artifact ? [] : sections,
            evidence: includeEvidence,
          };
          const payload = JSON.stringify(body);
          if (request.current?.payload !== payload)
            request.current = { payload, id: crypto.randomUUID() };
          share.mutate(
            { id: meetingId, ...body, request_id: request.current.id },
            {
              onSuccess: () => {
                request.current = null;
                setSelected(null);
              },
            },
          );
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">{localize('com_meeting_choose_recipient')}</legend>
          {recipients.data && !recipients.isError
            ? recipients.data.recipients.map((value) => (
                <label className="flex items-center gap-2 break-words" key={value.kind + value.id}>
                  <input
                    type="radio"
                    name="meeting-recipient"
                    checked={selected?.kind === value.kind && selected.id === value.id}
                    onChange={() => setSelected(value)}
                  />
                  {value.label ?? localize('com_meeting_recipient_removed')} ·{' '}
                  {localize(
                    value.kind === 'group'
                      ? 'com_meeting_recipient_group'
                      : 'com_meeting_recipient_user',
                  )}
                </label>
              ))
            : null}
          {!artifact && (
            <>
              <label htmlFor="meeting-share-version">{localize('com_meeting_share_version')}</label>
              <Input
                id="meeting-share-version"
                type="number"
                min={1}
                max={version}
                required
                value={selectedVersion}
                onChange={(event) => setSelectedVersion(Number(event.target.value))}
              />
            </>
          )}
        </fieldset>
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{localize('com_meeting_share_sections')}</legend>
          {!artifact &&
            (Object.keys(sectionLabels) as TMeetingSharedSection[]).map((kind) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sections.includes(kind)}
                  onChange={(event) =>
                    setSections((previous) =>
                      event.target.checked
                        ? [...previous, kind]
                        : previous.filter((value) => value !== kind),
                    )
                  }
                />
                {localize(sectionLabels[kind])}
              </label>
            ))}
          {artifact?.kind !== 'speech' && (
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={includeEvidence}
                onChange={(event) => setIncludeEvidence(event.target.checked)}
                className="mt-1"
              />
              {localize('com_meeting_share_evidence')}
            </label>
          )}
        </fieldset>
        <Button type="submit" disabled={!selected || !sections.length || busy}>
          {localize(share.isLoading ? 'com_meeting_sharing_pending' : 'com_meeting_share_selected')}
        </Button>
        {share.isSuccess ? <p role="status">{localize('com_meeting_shared_saved')}</p> : null}
        {share.isError || revoke.isError ? (
          <p role="alert">{localize('com_meeting_share_error')}</p>
        ) : null}
      </form>
      <h4 className="font-semibold">{localize('com_meeting_share_grants')}</h4>
      {shares.isLoading ? (
        <Spinner className="size-5" aria-label={localize('com_ui_loading')} />
      ) : null}
      {shares.isError ? (
        <div role="alert">
          <p>{localize('com_meeting_error')}</p>
          <Button variant="outline" onClick={() => shares.refetch()}>
            {localize('com_meeting_retry')}
          </Button>
        </div>
      ) : null}
      {grants?.length === 0 ? <p>{localize('com_meeting_share_private')}</p> : null}
      <ul className="flex flex-col gap-3">
        {shares.data && !shares.isError
          ? grants?.map((grant) => (
              <li
                key={grant.id}
                className="border-border-light flex flex-col gap-2 rounded-lg border p-3"
              >
                <p className="font-medium break-words">
                  {grant.recipient.label ?? localize('com_meeting_recipient_removed')} ·{' '}
                  {localize(
                    grant.recipient.kind === 'group'
                      ? 'com_meeting_recipient_group'
                      : 'com_meeting_recipient_user',
                  )}
                </p>
                <p>
                  {localize('com_meeting_shared_version', { version: grant.version })} ·{' '}
                  {grant.sections.map((kind) => localize(sectionLabels[kind])).join(', ')}
                </p>
                <p className="text-text-secondary">
                  {localize(
                    grant.evidence
                      ? 'com_meeting_shared_evidence_on'
                      : 'com_meeting_shared_evidence_off',
                  )}
                </p>
                {grant.revoked ? (
                  <p role="status">{localize('com_meeting_share_revoked')}</p>
                ) : (
                  <>
                    {grant.artifact_kind !== 'speech' && (
                      <Link
                        className="text-text-secondary underline"
                        to={
                          '/meetings/' +
                          meetingId +
                          (grant.artifact_kind === 'saved_answer'
                            ? '?sharedAnswer=' + grant.artifact_id
                            : '?sharedVersion=' + grant.version)
                        }
                      >
                        {localize('com_meeting_shared_link')}
                      </Link>
                    )}
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (!revocations.current.has(grant.id))
                          revocations.current.set(grant.id, crypto.randomUUID());
                        revoke.mutate({
                          id: meetingId,
                          grantId: grant.id,
                          request_id: revocations.current.get(grant.id)!,
                          expected_revision: grant.revision,
                        });
                      }}
                    >
                      {localize('com_meeting_share_revoke')}
                    </Button>
                  </>
                )}
              </li>
            ))
          : null}
      </ul>
    </section>
  );
}
