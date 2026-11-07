import { z } from 'zod';

export const meetingVoiceInputSchema = z.object({ operation_id: z.string().uuid() }).strict();
export const meetingVoiceAudioSchema = z
  .object({ audio_base64: z.string().min(1).max(1333336) })
  .strict();
export const meetingVoiceCancelSchema = z.object({}).strict();
export const meetingVoiceSchema = z.object({
  id: z.string().uuid(),
  state: z.enum([
    'recording',
    'accepted',
    'processing',
    'transcribed',
    'answering',
    'completed',
    'cancelled',
    'rejected',
    'uncertain',
  ]),
  attempt_id: z.string().uuid(),
  receipt_id: z.string().nullable(),
  receipt_state: z.string().nullable(),
  error_code: z.string().nullable(),
  max_seconds: z.number().int().positive(),
  duration_ms: z.number().int().nullable(),
  accepted_at: z.string().nullable().optional(),
  context_revision: z.string(),
  context_segment_count: z.number().int(),
  assistant_state: z.string(),
  assistant_receipt_state: z.string().nullable(),
  lease_until: z.string(),
});
export const meetingVoiceHistorySchema = z.object({ questions: z.array(meetingVoiceSchema) });
export type TMeetingVoice = z.infer<typeof meetingVoiceSchema>;
