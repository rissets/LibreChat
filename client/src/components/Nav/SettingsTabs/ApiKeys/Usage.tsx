import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import { useGetBPApiKeyUsageQuery } from 'librechat-data-provider/react-query';
import { useCopyToClipboard, useLocalize } from '~/hooks';

function number(value: number) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

export default function Usage() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useGetBPApiKeyUsageQuery();
  const copy = useCopyToClipboard({ text: data?.endpoint || '' });
  const refresh = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: [QueryKeys.agentApiKeys] }),
    ]);
  };

  if (isLoading) {
    return <div className="flex justify-center py-4"><Spinner className="h-5 w-5" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-status-error-border bg-status-error-subtle p-3 text-sm text-status-error">
        <div className="flex items-center justify-between gap-3">
          <span>{localize('com_ui_api_usage_load_error')}</span>
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={isFetching}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      </div>
    );
  }

  const totals = data.totals;
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-border-light bg-surface-secondary/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_ui_api_endpoint_title')}
          </h3>
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_ui_api_endpoint_help')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => copy(setCopied)}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? localize('com_ui_copied') : localize('com_ui_copy')}
        </Button>
      </div>
      <code className="block overflow-x-auto rounded-lg bg-surface-primary px-3 py-2 text-xs text-text-primary">
        {data.endpoint}
      </code>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={localize('com_ui_api_usage_requests')} value={number(totals.totalRequests)} />
        <Metric label={localize('com_ui_api_usage_success')} value={number(totals.successfulRequests)} />
        <Metric label={localize('com_ui_api_usage_errors')} value={number(totals.failedRequests)} />
        <Metric label={localize('com_ui_api_usage_tokens')} value={number(totals.totalTokens)} />
      </div>
      <div className="space-y-2">
        <div>
          <h4 className="text-xs font-semibold text-text-primary">
            {localize('com_ui_api_models_title')}
          </h4>
          <p className="mt-0.5 text-xs text-text-secondary">
            {localize('com_ui_api_models_help')}
          </p>
        </div>
        {data.models?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {data.models.map((model) => (
              <span
                key={model.id}
                className="inline-flex items-center gap-2 rounded-full border border-border-light bg-surface-primary px-2.5 py-1 text-xs text-text-primary"
                title={model.name}
              >
                <code className="font-medium">{model.id}</code>
                {model.name !== model.id && (
                  <span className="text-text-secondary">{model.name}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-secondary">{localize('com_ui_api_models_empty')}</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        <span>{localize('com_ui_api_usage_per_key')}</span>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => refresh()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {localize('com_ui_refresh')}
        </Button>
      </div>
      {data.keys.length > 0 && (
        <ul className="space-y-1.5 text-xs text-text-secondary">
          {data.keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate"><span className="text-text-primary">{key.name}</span> · {key.keyPrefix}…</span>
              <span className="shrink-0">{number(key.totalRequests)} req · {number(key.totalTokens)} tok</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary px-3 py-2">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}
