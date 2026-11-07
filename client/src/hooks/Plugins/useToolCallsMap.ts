import { ToolCallResult } from 'librechat-data-provider';
import { useMemo } from 'react';
import { useGetToolCalls } from '~/data-provider';
import { parseMeetingChatPath } from '~/data-provider/Meetings/path';
import { mapToolCalls, logger } from '~/utils';

type ToolCallsMap = {
  [x: string]: ToolCallResult[] | undefined;
};

export default function useToolCallsMap({
  conversationId,
}: {
  conversationId: string;
}): ToolCallsMap | undefined {
  const { data: toolCallsMap = null } = useGetToolCalls(
    { conversationId },
    {
      select: (res) => mapToolCalls(res),
      /** Meeting turns persist through the Control Panel, so LibreChat holds no
       *  tool-call records for that conversation and the gateway denies the read. */
      enabled: parseMeetingChatPath(conversationId) == null,
    },
  );

  const result = useMemo<ToolCallsMap | undefined>(() => {
    return toolCallsMap !== null ? toolCallsMap : undefined;
  }, [toolCallsMap]);

  logger.log('tools', 'tool calls map:', result);
  return result;
}
