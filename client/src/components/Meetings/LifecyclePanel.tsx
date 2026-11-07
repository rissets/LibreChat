import type { TMeetingLifecycle } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

const labels = {
  meeting: 'com_meeting_lifecycle_all',
  processing_audio: 'com_meeting_lifecycle_raw',
  transcript: 'com_meeting_lifecycle_source',
  results: 'com_meeting_lifecycle_results',
  answers: 'com_meeting_lifecycle_answers',
  speech: 'com_meeting_lifecycle_speech',
} as const;
const states = {
  completed: 'com_meeting_lifecycle_cleaned',
  failed: 'com_meeting_lifecycle_cleanup_failed',
  pending: 'com_meeting_lifecycle_cleanup_pending',
} as const;

export default function LifecyclePanel({ value }: { value?: TMeetingLifecycle }) {
  const localize = useLocalize();
  if (!value) return null;
  return (
    <section
      className="border-border-light flex flex-col gap-3 rounded-xl border p-4"
      aria-label={localize('com_meeting_lifecycle_title')}
    >
      <h2 className="font-semibold">{localize('com_meeting_lifecycle_title')}</h2>
      <p className="text-text-secondary">
        {localize(
          value.policy.configured
            ? 'com_meeting_lifecycle_configured'
            : 'com_meeting_lifecycle_unconfigured',
        )}
      </p>
      {value.removals.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {value.removals.map((row) => (
            <li key={row.id}>
              {localize(labels[row.artifact_class])} ·{' '}
              {localize(
                row.cause === 'expired'
                  ? 'com_meeting_lifecycle_expired'
                  : 'com_meeting_lifecycle_deleted',
              )}{' '}
              · {localize(states[row.state])}
            </li>
          ))}
        </ul>
      )}
      <p className="text-text-secondary text-sm">{localize('com_meeting_lifecycle_limits')}</p>
    </section>
  );
}
