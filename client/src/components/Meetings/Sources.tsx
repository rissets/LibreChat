import { useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Button } from '@librechat/client';
import type { TMeetingCitation } from 'librechat-data-provider';
import { useMeetingEvidence } from '~/data-provider/Meetings';
import { useLocalize } from '~/hooks';
import { formatMeetingTime } from './time';

export default function Sources({
  userId,
  meetingId,
  operationId,
  citations,
}: {
  userId?: string;
  meetingId: string;
  operationId?: string;
  citations: TMeetingCitation[];
}) {
  const localize = useLocalize();
  const [selected, setSelected] = useState<TMeetingCitation>();
  const evidence = useMeetingEvidence(
    userId,
    meetingId,
    operationId,
    selected?.segment_id,
    selected?.revision,
  );
  if (!citations.length || !operationId) return null;
  return (
    <div className="text-text-secondary mt-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {citations.map((citation, i) => (
          <button
            type="button"
            key={citation.segment_id + ':' + citation.revision}
            className="hover:bg-surface-hover focus-visible:outline-text-primary inline-flex min-h-8 items-center gap-1 rounded-md px-2 focus-visible:outline focus-visible:outline-2"
            onClick={() => setSelected(citation)}
          >
            <FileText className="size-3" aria-hidden="true" />
            {localize('com_meeting_workspace_source')} {i + 1}
          </button>
        ))}
      </div>
      {selected && (
        <div
          className="bg-surface-secondary mt-2 rounded-lg p-3"
          role="region"
          aria-label={localize('com_meeting_evidence')}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span>
              {evidence.data?.segment.state === 'note'
                ? localize('com_meeting_workspace_notes')
                : formatMeetingTime(evidence.data?.segment.start_ms ?? 0)}{' '}
              · {localize('com_meeting_revision')} {selected.revision}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={localize('com_ui_close')}
              onClick={() => setSelected(undefined)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {evidence.isLoading ? <p role="status">{localize('com_ui_loading')}</p> : null}
          {evidence.isError && <p role="alert">{localize('com_meeting_unavailable')}</p>}
          {!evidence.isLoading && !evidence.isError && (
            <p className="text-text-primary text-sm whitespace-pre-wrap">
              {evidence.data?.segment.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
