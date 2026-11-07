import { z } from 'zod';
import { meetingCitationSchema } from './meetings';

export const meetingSharedSectionSchema = z.enum([
  'transcript',
  'summary',
  'decisions',
  'unresolved',
  'actions',
  'unknowns',
]);
const recipient = z.object({
  kind: z.enum(['user', 'group']),
  id: z.string(),
  label: z.string().nullable(),
});
const fact = z.object({
  text: z.string(),
  citations: z.array(meetingCitationSchema),
  human_corrected: z.boolean().optional(),
});
const segment = z.object({
  id: z.string(),
  revision: z.number().int(),
  text: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  speaker: z.string().nullable(),
  state: z.string(),
  time_precision: z.string().optional(),
  human_corrected: z.boolean().optional(),
});
export const meetingShareInputSchema = z
  .object({
    request_id: z.string().uuid(),
    recipient_kind: z.enum(['user', 'group']),
    recipient_id: z.string().min(1).max(200),
    artifact_kind: z.enum(['final_result', 'saved_answer', 'speech']),
    artifact_id: z.string().uuid().optional(),
    version: z.number().int().min(1).max(1000000),
    sections: z.array(meetingSharedSectionSchema).max(6),
    evidence: z.boolean(),
  })
  .strict();
export const meetingShareRevokeInputSchema = z
  .object({
    request_id: z.string().uuid(),
    expected_revision: z.number().int().positive(),
  })
  .strict();
export const meetingRecipientsSchema = z.object({ recipients: z.array(recipient) });
export const meetingShareSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int(),
  recipient,
  artifact_kind: z.enum(['final_result', 'saved_answer', 'speech']),
  artifact_id: z.string().uuid().optional(),
  version: z.number().int(),
  sections: z.array(meetingSharedSectionSchema),
  evidence: z.boolean(),
  revoked: z.boolean(),
});
export const meetingSharesSchema = z.object({ grants: z.array(meetingShareSchema) });
export const meetingSharedArtifactsSchema = z.object({
  artifacts: z.array(
    z.object({
      meeting_id: z.string().uuid(),
      title: z.string(),
      kind: z.enum(['final_result', 'saved_answer']),
      artifact_id: z.string().uuid().optional(),
      version: z.number().int(),
      sections: z.array(meetingSharedSectionSchema),
      evidence: z.boolean(),
    }),
  ),
});
export const meetingSharedResultSchema = z
  .object({
    meeting_id: z.string().uuid(),
    title: z.string(),
    kind: z.literal('final_result'),
    version: z.number().int(),
    source_revision: z.string(),
    review_state: z.string(),
    change_kind: z.enum(['generated', 'correction', 'review']),
    completeness: z.enum(['complete', 'incomplete']),
    evidence_allowed: z.boolean(),
    evidence_sections: z.array(meetingSharedSectionSchema),
    sections: z
      .object({
        transcript: z.array(segment.extend({ source_state: z.string().optional() })).optional(),
        summary: z.array(fact).optional(),
        decisions: z.array(fact).optional(),
        unresolved: z.array(fact).optional(),
        actions: z
          .array(fact.extend({ owner: z.string().nullable(), due_date: z.string().nullable() }))
          .optional(),
        unknowns: z.array(z.string()).optional(),
      })
      .strict(),
  })
  .strict();
export const meetingSharedEvidenceSchema = z.object({
  version: z.number().int(),
  source_revision: z.string(),
  segment,
});
export const meetingSharedAnswerSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  content: z.object({ answer: z.string(), citations: z.array(meetingCitationSchema) }),
  context_revision: z.string(),
  evidence_allowed: z.boolean(),
  speech_allowed: z.boolean(),
});
export type TMeetingShareInput = z.infer<typeof meetingShareInputSchema>;
export type TMeetingShareRevokeInput = z.infer<typeof meetingShareRevokeInputSchema>;
export type TMeetingShare = z.infer<typeof meetingShareSchema>;
export type TMeetingSharedSection = z.infer<typeof meetingSharedSectionSchema>;
export type TMeetingRecipient = z.infer<typeof recipient>;
