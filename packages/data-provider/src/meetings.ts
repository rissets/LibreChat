import { z } from 'zod';

export const meetingSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  meeting_date: z.string().nullable().optional(),
  agenda: z.string().nullable().optional(),
  created_at: z.string(),
  revision: z.number().int(),
  capture_state: z.enum(['not_started', 'capturing', 'paused', 'stopped', 'interrupted', 'failed']),
  finalization_state: z.enum([
    'not_requested',
    'queued',
    'running',
    'failed',
    'incomplete',
    'completed',
  ]),
  visibility: z.literal('private'),
  artifact_classes: z.array(z.string()),
});
export const meetingSessionsSchema = z.object({
  sessions: z.array(meetingSessionSchema),
  page: z.number().int().positive().optional(),
  has_more: z.boolean().optional(),
});
export const meetingAccessSchema = z.object({
  allowed: z.boolean(),
  policy_revisions: z.array(z.object({ id: z.string(), revision: z.number().int() })),
});
export type TMeetingSession = z.infer<typeof meetingSessionSchema>;
export type TMeetingAccess = z.infer<typeof meetingAccessSchema>;

export const meetingCaptureInputSchema = z
  .object({
    action: z.enum(['start', 'pause', 'resume', 'recover', 'heartbeat', 'stop', 'interrupt']),
    capture_token: z.string().uuid().optional(),
    reason: z.enum(['device', 'permission', 'network', 'buffer', 'browser_stopped']).optional(),
  })
  .strict();
export const meetingAudioInputSchema = z
  .object({
    capture_id: z.string().uuid(),
    capture_token: z.string().uuid().optional(),
    chunk_id: z.string().uuid(),
    sequence: z.number().int().min(0).max(1000000),
    audio_base64: z.string().min(1).max(1333336),
  })
  .strict();
export const meetingCaptureSchema = z.object({
  id: z.string().uuid(),
  capture_token: z.string().uuid(),
  state: z.enum(['capturing', 'paused', 'stopped', 'interrupted', 'failed']),
  next_sequence: z.number().int(),
  elapsed_ms: z.number(),
  policy_revision: z.string(),
});
export const meetingAudioAckSchema = z.object({
  id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  capture_id: z.string().uuid(),
  sequence: z.number().int(),
  durable: z.literal(true),
  state: z.enum(['accepted', 'processing', 'completed', 'rejected', 'uncertain']),
  start_ms: z.number(),
  duration_ms: z.number(),
  attempt_id: z.string().uuid(),
  receipt_id: z.string().nullable(),
  error_code: z.string().nullable(),
});
export const meetingLimitsSchema = z.object({
  duration_limit_seconds: z.number().int().positive(),
  duration_source: z.enum(['applied_policy', 'technical_safeguard']),
  technical_max_seconds: z.number().int().positive(),
  observed_seconds: z.number().nonnegative(),
  slot_held: z.boolean(),
  slot_expires_at: z.string().nullable(),
  error_code: z.string().nullable(),
  policies: z.array(
    z.object({
      department_id: z.string().nullable(),
      revision: z.number().int(),
      max_duration_seconds: z.number().int().nullable(),
      max_concurrent: z.number().int().nullable(),
    }),
  ),
});
export const meetingTranscriptSchema = z.object({
  playbacks: z.array(
    z.object({
      id: z.string().uuid(),
      speech_id: z.string().uuid(),
      source: z.literal('assistant'),
      state: z.string(),
      requested_at: z.string(),
      started_at: z.string().nullable(),
      ended_at: z.string().nullable(),
      lease_until: z.string(),
      lease_remaining_ms: z.number().nonnegative(),
      end_reason: z.string().nullable(),
    }),
  ),
  limits: meetingLimitsSchema,
  context_revision: z.string(),
  recovery_retention_seconds: z.number().int().positive(),
  gaps: z.array(
    z.object({
      id: z.string().uuid(),
      capture_id: z.string().uuid(),
      start_ms: z.number(),
      end_ms: z.number().nullable(),
      reason: z.enum([
        'paused',
        'device',
        'permission',
        'network',
        'buffer',
        'browser_stopped',
        'server_restart',
        'unrecoverable_audio',
        'capacity',
        'duration_limit',
      ]),
      time_precision: z.enum(['estimated', 'unknown']),
    }),
  ),
  capture: meetingCaptureSchema.nullable(),
  acknowledgements: z.array(meetingAudioAckSchema),
  segments: z.array(
    z.object({
      id: z.string().uuid(),
      capture_id: z.string().uuid(),
      audio_id: z.string().uuid(),
      start_ms: z.number(),
      end_ms: z.number(),
      text: z.string(),
      revision: z.number().int(),
      state: z.enum(['provisional', 'stable', 'final']),
      speaker: z.string().nullable(),
      speaker_source: z
        .enum(['provider_provisional', 'diarization', 'diarization_unknown'])
        .optional(),
      human_corrected: z.boolean().optional(),
      time_precision: z.enum(['chunk', 'provider']),
      deployment_id: z.string(),
      adapter_version: z.string(),
      model_version: z.string(),
    }),
  ),
});
export type TMeetingCaptureInput = z.infer<typeof meetingCaptureInputSchema>;
export type TMeetingCapture = z.infer<typeof meetingCaptureSchema>;
export type TMeetingAudioInput = z.infer<typeof meetingAudioInputSchema>;
export type TMeetingTranscript = z.infer<typeof meetingTranscriptSchema>;

export const meetingCitationSchema = z.object({
  segment_id: z.string(),
  revision: z.number().int(),
});
const meetingFactSchema = z.object({ text: z.string(), citations: z.array(meetingCitationSchema) });
export const meetingAssistantInputSchema = z
  .object({
    operation_id: z.string().uuid(),
    purpose: z.enum(['answer', 'summary']),
    question: z.string().max(2000),
  })
  .strict();
export const meetingAssistantSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(['answer', 'summary']),
  input_kind: z.enum(['text', 'voice']).default('text'),
  question: z.string(),
  context_revision: z.string(),
  context_segment_count: z.number().int(),
  context_end_ms: z.number(),
  context_notes_revision: z.number().int().optional(),
  context_speaker_revision: z.number().int().optional(),
  attempt_id: z.string().uuid(),
  state: z.enum(['accepted', 'processing', 'completed', 'rejected', 'uncertain', 'cancelled']),
  receipt_id: z.string().nullable(),
  receipt_state: z.string().nullable(),
  error_code: z.string().nullable(),
  policy_revision: z.string(),
  created_at: z.string(),
  provenance: z.record(z.string(), z.string().nullable()),
  content: z
    .object({
      answer: z.string(),
      citations: z.array(meetingCitationSchema),
      summary: z.array(meetingFactSchema),
      decisions: z.array(meetingFactSchema),
      unresolved: z.array(meetingFactSchema),
      actions: z.array(
        meetingFactSchema.extend({ owner: z.string().nullable(), due_date: z.string().nullable() }),
      ),
      unknowns: z.array(z.string()),
      enhanced_notes: z.array(meetingFactSchema).default([]),
      discussion_qa: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string().nullable(),
            question_speaker: z.string().nullable(),
            answer_speaker: z.string().nullable(),
            citations: z.array(meetingCitationSchema),
          }),
        )
        .default([]),
    })
    .nullable(),
});
export const meetingAssistantHistorySchema = z.object({
  operations: z.array(meetingAssistantSchema),
});
export const meetingEvidenceSchema = z.object({
  context_revision: z.string(),
  segment: z.object({
    id: z.string(),
    revision: z.number().int(),
    text: z.string(),
    start_ms: z.number(),
    end_ms: z.number(),
    speaker: z.string().nullable(),
    human_corrected: z.boolean().optional(),
    state: z.string(),
  }),
});
export type TMeetingAssistant = z.infer<typeof meetingAssistantSchema>;
export type TMeetingAssistantInput = z.infer<typeof meetingAssistantInputSchema>;
export type TMeetingCitation = z.infer<typeof meetingCitationSchema>;

export const meetingSpeechInputSchema = z.object({ operation_id: z.string().uuid() }).strict();
export const meetingSpeechSchema = z.object({
  id: z.string().uuid(),
  answer_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  policy_revision: z.string(),
  state: z.enum(['processing', 'ready', 'rejected', 'uncertain', 'expired']),
  receipt_id: z.string().nullable(),
  receipt_state: z.string().nullable(),
  error_code: z.string().nullable(),
  expires_at: z.string().nullable(),
  provenance: z.object({
    context_phase: z.enum(['live', 'postmeeting']).optional(),
    deployment_id: z.string().optional(),
    adapter_version: z.string().optional(),
    model_version: z.string().optional(),
    synthesis_ms: z.number().optional(),
    duration_seconds: z.number().optional(),
  }),
});
export const meetingSpeechStatusSchema = z.object({ speech: meetingSpeechSchema.nullable() });
export const meetingPlaybackInputSchema = z
  .object({
    action: z.enum(['start', 'playing', 'heartbeat', 'stop']),
    playback_id: z.string().uuid(),
    reason: z.enum(['stopped', 'ended', 'failed', 'left', 'access']).optional(),
  })
  .strict();
export const meetingPlaybackSchema = z.object({
  playback: z
    .object({
      id: z.string().uuid(),
      speech_id: z.string().uuid(),
      source: z.literal('assistant'),
      state: z.string(),
      requested_at: z.string(),
      started_at: z.string().nullable(),
      ended_at: z.string().nullable(),
      lease_until: z.string(),
      lease_remaining_ms: z.number().nonnegative(),
      end_reason: z.string().nullable(),
    })
    .nullable(),
  audio_base64: z.string().optional(),
  mime_type: z.literal('audio/wav').optional(),
});
export type TMeetingSpeechInput = z.infer<typeof meetingSpeechInputSchema>;
export type TMeetingPlaybackInput = z.infer<typeof meetingPlaybackInputSchema>;
