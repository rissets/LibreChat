import { z } from 'zod';
import { meetingCitationSchema, meetingTranscriptSchema } from './meetings';

const fact = z.object({
  text: z.string(),
  citations: z.array(meetingCitationSchema),
  human_corrected: z.boolean().optional(),
});
const segment = meetingTranscriptSchema.shape.segments.element;
export const meetingFinalizationInputSchema = z.object({ request_id: z.string().uuid() }).strict();
const resultVersion = z.object({
  version: z.number().int().min(1),
  source_revision: z.string(),
  review_state: z.enum(['draft', 'reviewed']),
  parent_version: z.number().int().nullable(),
  change_kind: z.enum(['generated', 'correction', 'review']),
  actor_id: z.string().nullable(),
  actor_label: z.string().max(200).nullable().optional(),
  acted_at: z.string(),
});
export const meetingReviewInputSchema = z
  .object({ request_id: z.string().uuid(), expected_version: z.number().int().min(1).max(1000000) })
  .strict();
export const meetingCorrectionInputSchema = meetingReviewInputSchema
  .extend({
    segments: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            expected_revision: z.number().int().min(1).max(1000000),
            text: z.string().trim().min(1).max(50000),
            speaker: z.string().trim().max(100).nullable(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    facts: z
      .array(
        z
          .object({
            section: z.enum(['summary', 'decisions', 'unresolved', 'actions']),
            index: z.number().int().min(0).max(999),
            text: z.string().trim().min(1).max(4000),
            owner: z.string().trim().max(200).nullable().optional(),
            due_date: z.string().trim().max(100).nullable().optional(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
  })
  .strict();
export const meetingFinalResultSchema = resultVersion.extend({
  visibility: z.literal('private'),
  generated: z.boolean(),
  completeness: z.enum(['complete', 'incomplete']),
  incomplete_reasons: z.array(z.string()),
  transcript: z.array(segment.extend({ state: z.literal('final'), source_state: z.string() })),
  summary: z.array(fact),
  decisions: z.array(fact),
  unresolved: z.array(fact),
  actions: z.array(fact.extend({ owner: z.string().nullable(), due_date: z.string().nullable() })),
  unknowns: z.array(z.string()),
  gaps: z.array(
    z.object({
      id: z.string(),
      capture_id: z.string(),
      start_ms: z.number(),
      end_ms: z.number().nullable(),
      reason: z.string(),
      time_precision: z.string(),
    }),
  ),
});
export const meetingFinalizationSchema = z.object({
  id: z.string().uuid().optional(),
  meeting_id: z.string().uuid().optional(),
  state: z.enum(['not_requested', 'queued', 'running', 'failed', 'incomplete', 'completed']),
  durable: z.boolean(),
  stage: z.string().optional(),
  created_at: z.string().optional(),
  finished_at: z.string().nullable().optional(),
  source_revision: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  can_retry: z.boolean(),
  latest_version: z.number().int().nullable().optional(),
  versions: z.array(resultVersion).optional(),
  attempts: z
    .array(
      z.object({
        id: z.string().uuid(),
        number: z.number().int(),
        state: z.string(),
        receipt_id: z.string().nullable(),
        receipt_state: z.string().nullable(),
        policy_revision: z.string().nullable(),
        error_code: z.string().nullable(),
      }),
    )
    .optional(),
  result: meetingFinalResultSchema.nullable(),
});
export const meetingFinalEvidenceSchema = z.object({
  version: z.number().int().min(1),
  source_revision: z.string(),
  segment,
});
export type TMeetingFinalization = z.infer<typeof meetingFinalizationSchema>;
export type TMeetingFinalResult = z.infer<typeof meetingFinalResultSchema>;
export type TMeetingFinalEvidence = z.infer<typeof meetingFinalEvidenceSchema>;
export type TMeetingCorrectionInput = z.infer<typeof meetingCorrectionInputSchema>;
export type TMeetingReviewInput = z.infer<typeof meetingReviewInputSchema>;
