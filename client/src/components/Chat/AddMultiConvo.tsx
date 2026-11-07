import { PlusCircle } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import useMultiConvo from '~/hooks/Conversations/useMultiConvo';
import { useLocalize } from '~/hooks';

function StandardAddMultiConvo() {
  const localize = useLocalize();
  const { show, addConversation } = useMultiConvo();

  if (!show) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_ui_add_multi_conversation')}
      render={
        <Button
          size="icon"
          className="size-9"
          variant="header-action"
          aria-label={localize('com_ui_add_multi_conversation')}
          onClick={addConversation}
          data-testid="add-multi-convo-button"
        >
          <PlusCircle className="icon-sm" aria-hidden="true" />
        </Button>
      }
    />
  );
}

export default function AddMultiConvo({ disabledReason }: { disabledReason?: string }) {
  const localize = useLocalize();
  if (!disabledReason) return <StandardAddMultiConvo />;
  return (
    <TooltipAnchor
      description={disabledReason}
      render={
        <Button
          size="icon"
          className="size-9"
          variant="header-action"
          aria-disabled="true"
          aria-label={localize('com_ui_add_multi_conversation')}
          data-testid="add-multi-convo-button"
        >
          <PlusCircle className="icon-sm" aria-hidden="true" />
        </Button>
      }
    />
  );
}
