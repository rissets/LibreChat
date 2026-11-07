import type { TMeetingTranscript } from 'librechat-data-provider';
import { formatMeetingTime } from './time';
import { useLocalize } from '~/hooks';

export default function Limits({ value }: { value: TMeetingTranscript['limits'] }) {
  const localize = useLocalize();
  const elapsed = formatMeetingTime(value.observed_seconds * 1000);
  const duration = formatMeetingTime(value.duration_limit_seconds * 1000);

  return (
    <section
      className="border-border-light flex flex-col gap-5 rounded-xl border p-4 sm:p-5"
      aria-label={localize('com_meeting_limits')}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold">{localize('com_meeting_limit_time_heading')}</h3>
          <p className="text-text-secondary text-sm tabular-nums">
            <span className="text-text-primary font-semibold">{elapsed}</span>
            {' / '}
            {duration}
          </p>
        </div>
        <progress
          className="accent-primary h-2 w-full overflow-hidden rounded-full"
          aria-label={localize('com_meeting_limit_time_heading')}
          aria-valuetext={localize('com_meeting_limit_duration', { duration, elapsed })}
          max={value.duration_limit_seconds}
          value={Math.min(value.observed_seconds, value.duration_limit_seconds)}
        />
        <p className="text-text-secondary text-xs">{localize('com_meeting_limit_time_note')}</p>
      </div>
      <div className="border-border-light grid gap-4 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{localize('com_meeting_limit_slot_heading')}</h3>
          <p className="text-text-secondary text-sm leading-6">
            {localize(value.slot_held ? 'com_meeting_slot_active' : 'com_meeting_slot_available')}
          </p>
        </div>
        {value.policies.some((policy) => policy.max_concurrent !== null) && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">
              {localize('com_meeting_limit_capacity_heading')}
            </h3>
            {value.policies.map((policy) =>
              policy.max_concurrent !== null ? (
                <p
                  className="text-text-secondary text-sm leading-6"
                  key={policy.department_id ?? 'organization'}
                >
                  {localize(
                    policy.department_id === null
                      ? 'com_meeting_limit_organization'
                      : 'com_meeting_limit_department',
                  )}
                  {' · '}
                  {localize('com_meeting_limit_concurrent', { count: policy.max_concurrent })}
                </p>
              ) : null,
            )}
          </div>
        )}
      </div>
      <details className="border-border-light border-t pt-3 text-sm">
        <summary className="text-text-secondary hover:text-text-primary min-h-9 cursor-pointer font-medium">
          {localize('com_meeting_limit_details')}
        </summary>
        <div className="text-text-secondary mt-2 flex max-w-prose flex-col gap-3 leading-6">
          <p>
            {localize(
              value.duration_source === 'applied_policy'
                ? 'com_meeting_duration_policy'
                : 'com_meeting_duration_safeguard',
              { seconds: value.duration_limit_seconds },
            )}
          </p>
          <p>{localize('com_meeting_duration_semantics')}</p>
          <p>
            {localize('com_meeting_timeline_safeguard', { seconds: value.technical_max_seconds })}
          </p>
          <p>{localize(value.slot_held ? 'com_meeting_slot_held' : 'com_meeting_slot_released')}</p>
          <p>{localize('com_meeting_capacity_qualification')}</p>
          {value.policies.map((policy) => (
            <p key={policy.department_id ?? 'organization'}>
              {localize(
                policy.department_id === null
                  ? 'com_meeting_limit_organization'
                  : 'com_meeting_limit_department',
              )}
              {' · '}
              {localize('com_meeting_limit_revision', { revision: policy.revision })}
            </p>
          ))}
        </div>
      </details>
      {value.error_code === 'MEETING_DURATION_LIMIT' && (
        <p role="alert" className="text-sm font-semibold">
          {localize('com_meeting_duration_reached')}
        </p>
      )}
      {value.error_code === 'MEETING_CONCURRENCY_LIMIT' && (
        <p role="alert" className="text-sm font-semibold">
          {localize('com_meeting_concurrency_full')}
        </p>
      )}
    </section>
  );
}
