import { memo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, useLocalStorage } from '~/hooks';
import { cn } from '~/utils';
import { Collapse } from '~/components/ui';
import Convo from '~/components/Conversations/Convo';

const noop = () => {};

/** Meeting chats arrive in the same list as ordinary conversations (their id is
 *  `meeting-<meetingId>-<chatId>`), so the Chats section hands them over here and
 *  lists chats alone. Collapsed state is remembered like the Chats section's. */
const MeetingChatsSection = memo(function MeetingChatsSection({
  conversations,
  toggleNav,
}: {
  conversations: TConversation[];
  toggleNav: (afterSlide?: () => void) => void;
}) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useLocalStorage('meetingChatsExpanded', true);
  const onToggle = useCallback(() => setIsExpanded(!isExpanded), [isExpanded, setIsExpanded]);

  if (conversations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col px-3 pt-3 text-sm">
      <div className="flex h-8 w-full items-center pe-1">
        <button
          onClick={onToggle}
          className={cn(buttonVariants({ variant: 'section-header' }), 'group min-w-0 flex-1')}
          type="button"
          aria-expanded={isExpanded}
        >
          <span className="truncate select-none">{localize('com_ui_meeting')}</span>
          <span className="text-text-tertiary"> · {conversations.length}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-200',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      <Collapse open={isExpanded}>
        <ul className="flex flex-col">
          {conversations.map((conversation) => (
            <li key={conversation.conversationId}>
              <Convo conversation={conversation} retainView={noop} toggleNav={toggleNav} />
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
});

MeetingChatsSection.displayName = 'MeetingChatsSection';

export default MeetingChatsSection;
