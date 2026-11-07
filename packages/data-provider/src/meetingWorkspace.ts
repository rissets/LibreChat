import { z } from 'zod';
import { meetingAssistantSchema } from './meetings';

export const meetingChatSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const meetingWorkspaceInputSchema = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    notes: z.string().max(16000),
    speaker_names: z.record(z.string().max(100), z.string().trim().min(1).max(100)).optional(),
    expected_speaker_revision: z.number().int().nonnegative().optional(),
    live_synthesis_enabled: z.boolean().optional(),
    retry_live_enhance: z.boolean().optional(),
  })
  .strict();
export const meetingChatMessageInputSchema = z
  .object({
    operation_id: z.string().uuid(),
    question: z.string().trim().min(1).max(2000),
  })
  .strict();
export const meetingWorkspaceSchema = z.object({
  meeting_id: z.string().uuid(),
  notes: z.object({
    text: z.string(),
    revision: z.number().int(),
    updated_at: z.string().nullable(),
  }),
  speakers: z.object({ revision: z.number().int(), names: z.record(z.string(), z.string()) }),
  capabilities: z.object({
    diarization: z.object({
      ready: z.boolean(),
      code: z.string().nullable().optional(),
      configured: z.boolean().optional(),
      state: z.string().optional(),
    }),
    live_synthesis: z.object({ ready: z.boolean() }),
  }),
  synthesis: z.object({
    state: z.string(),
    enabled: z.boolean(),
    context_revision: z.string().nullable(),
    notes_revision: z.number().int().nullable(),
    operation_id: z.string().nullable(),
    content: meetingAssistantSchema.shape.content,
    error_code: z.string().nullable(),
  }),
  live_enhance: z
    .object({
      enabled: z.boolean(),
      state: z.string(),
      notes_revision: z.number().int(),
      content: meetingAssistantSchema.shape.content,
      error_code: z.string().nullable(),
    })
    .optional(),
  chat: meetingChatSchema.nullable(),
});
export const meetingChatsSchema = z.object({ chats: z.array(meetingChatSchema) });
export const meetingChatDetailSchema = z.object({
  chat: meetingChatSchema,
  operations: z.array(meetingAssistantSchema),
});
export const meetingNativeSegmentSchema = z
  .object({
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    text: z.string().max(50000),
    start_ms: z.number().nonnegative(),
    end_ms: z.number().nonnegative(),
    speaker: z.string().nullable(),
    speaker_source: z
      .enum(['provider_provisional', 'diarization', 'diarization_unknown'])
      .optional(),
    human_corrected: z.boolean().optional(),
    state: z.string().max(30),
  })
  .strict();
export const meetingNativeNotesSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    text: z.string().max(16000),
  })
  .strict();
export const meetingNativeContextSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    chat_id: z.string().uuid().optional(),
    notes: meetingNativeNotesSchema,
    segments: z.array(meetingNativeSegmentSchema).max(500),
  })
  .strict();
export type TMeetingWorkspace = z.infer<typeof meetingWorkspaceSchema>;
export type TMeetingWorkspaceInput = z.infer<typeof meetingWorkspaceInputSchema>;
export type TMeetingChat = z.infer<typeof meetingChatSchema>;
export type TMeetingChatDetail = z.infer<typeof meetingChatDetailSchema>;
export type TMeetingChatMessageInput = z.infer<typeof meetingChatMessageInputSchema>;
export type TMeetingNativeSegment = z.infer<typeof meetingNativeSegmentSchema>;
export type TMeetingNativeNotes = z.infer<typeof meetingNativeNotesSchema>;
export type TMeetingNativeContext = z.infer<typeof meetingNativeContextSchema>;
