import { z } from 'zod';

export const meetingLifecycleSchema = z.object({
  meeting_id: z.string().uuid(),
  generation: z.number().int().nonnegative(),
  policy: z.object({
    configured: z.boolean(),
    seconds: z.record(z.number().int().positive().nullable()),
    clocks: z.record(z.string()),
    policy_revisions: z.array(z.object({ id: z.string(), revision: z.number().int() })),
  }),
  classes: z.record(z.object({ available: z.boolean() })),
  removals: z.array(
    z.object({
      id: z.string(),
      artifact_class: z.enum([
        'meeting',
        'processing_audio',
        'transcript',
        'results',
        'answers',
        'speech',
      ]),
      artifact_id: z.string(),
      through_at: z.string().nullable(),
      cause: z.enum(['expired', 'deleted']),
      generation: z.number().int(),
      state: z.enum(['pending', 'completed', 'failed']),
      attempts: z.number().int(),
      command_id: z.string().nullable(),
      error_code: z.string().nullable(),
      created_at: z.string(),
      finished_at: z.string().nullable(),
    }),
  ),
});
export type TMeetingLifecycle = z.infer<typeof meetingLifecycleSchema>;
