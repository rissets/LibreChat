import { Mic } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { IconButton, TooltipAnchor } from '@librechat/client';
import { parseMeetingChatPath } from '~/data-provider/Meetings/path';
import { useOptionalMeetingRuntime } from './runtime-context';
import { VoicePanel } from './VoicePanel';
import { useLocalize } from '~/hooks';

/** The native composer may use only the capture runtime's governed voice lane. */
export default function MeetingVoice({ conversationId }: { conversationId: string }) {
  const localize = useLocalize();
  const binding = parseMeetingChatPath(conversationId);
  const runtime = useOptionalMeetingRuntime();
  if (!binding || runtime?.session?.id !== binding.meetingId || !runtime.microphone) return null;
  return (
    <Ariakit.PopoverProvider placement="top-end">
      <Ariakit.PopoverDisclosure
        render={
          <TooltipAnchor
            description={localize('com_ui_use_micrphone')}
            render={
              <IconButton
                label={localize('com_ui_use_micrphone')}
                size="md"
                shape="composer"
                variant="ghost"
              />
            }
          />
        }
      >
        <Mic className="text-text-secondary size-5" aria-hidden="true" />
      </Ariakit.PopoverDisclosure>
      <Ariakit.Popover
        portal
        gutter={8}
        aria-label={localize('com_meeting_voice')}
        className="popover-animate border-border-medium bg-surface-secondary text-text-primary rounded-theme-popover z-50 w-80 max-w-[calc(100vw-2rem)] border p-4 shadow-lg"
      >
        <VoicePanel
          compact
          meetingId={binding.meetingId}
          userId={runtime.userId}
          microphone={runtime.microphone}
        />
      </Ariakit.Popover>
    </Ariakit.PopoverProvider>
  );
}
