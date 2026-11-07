import { useState } from 'react';
import { Volume2, ChevronDown } from 'lucide-react';
import type { TMessage } from 'librechat-data-provider';
import type { z } from 'zod';
import type { metadataSchema } from './metadata';
import { useAuthContext } from '~/hooks/AuthContext';
import { meetingMessageContext } from './metadata';
import { SpeechPanel } from './SpeechPanel';
import { formatMeetingTime } from './time';
import { useLocalize } from '~/hooks';
import Sources from './Sources';

/** Source and playback actions extend the standard message, never its renderer. */
function MeetingDetails({
  message,
  context,
}: {
  message: TMessage;
  context: z.infer<typeof metadataSchema>;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const [speechOpen, setSpeechOpen] = useState(false);
  const pending = ['accepted', 'processing'].includes(context.state);
  return (
    <div className="text-text-secondary mt-2 text-xs">
      {pending && <p role="status">{localize('com_meeting_assistant_pending')}</p>}
      {context.context_end_ms != null && (
        <p>
          {localize('com_meeting_workspace_context_until')}{' '}
          {formatMeetingTime(context.context_end_ms)}
        </p>
      )}
      <Sources
        userId={user?.id}
        meetingId={context.meeting_id}
        operationId={context.operation_id}
        citations={context.citations}
      />
      {context.state === 'completed' && (
        <details className="group mt-2" onToggle={(event) => setSpeechOpen(event.currentTarget.open)}>
          <summary className="border-border-light hover:bg-surface-hover hover:text-text-primary text-text-secondary inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-control">
            <Volume2 className="size-3.5 text-primary" aria-hidden="true" />
            <span>{localize('com_meeting_workspace_listen')}</span>
            <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
          </summary>
          {speechOpen && (
            <div className="mt-2">
              <SpeechPanel
                userId={user?.id}
                meetingId={context.meeting_id}
                answerId={context.operation_id}
                answerText={message.text}
                hideSharing
              />
            </div>
          )}
        </details>
      )}
    </div>
  );
}

export default function MeetingContext({ message }: { message: TMessage }) {
  const context = meetingMessageContext(message);
  return context ? <MeetingDetails message={message} context={context} /> : null;
}
