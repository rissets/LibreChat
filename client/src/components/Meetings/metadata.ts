import { z } from 'zod';
import type { TMessage } from 'librechat-data-provider';
import { parseMeetingChatPath } from '~/data-provider/Meetings/path';

export const metadataSchema = z.object({
  meeting_id: z.string().uuid(),
  chat_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  state: z.string(),
  context_revision: z.string().nullable().optional(),
  context_end_ms: z.number().nullable().optional(),
  context_notes_revision: z.number().nullable().optional(),
  citations: z.array(z.object({ segment_id: z.string(), revision: z.number() })).default([]),
});
export function meetingMessageContext(message: TMessage) {
  const binding = parseMeetingChatPath(message.conversationId ?? '');
  if (!binding || message.isCreatedByUser) return null;
  const result = metadataSchema.safeParse(message.metadata?.meeting);
  return result.success &&
    result.data.meeting_id === binding.meetingId &&
    result.data.chat_id === binding.chatId
    ? result.data
    : null;
}
