import { Button } from '@librechat/client';
import { useGatewayAccount, remainingPercentage } from '~/data-provider/Gateway';
import { useLocalize } from '~/hooks';

const count = (value: string | number) => Number(value).toLocaleString();
const date = (value: string) => new Date(value).toLocaleString();
export default function GatewayUsage() {
  const t = useLocalize();
  const query = useGatewayAccount(true);
  const data = query.data;
  return (
    <div className="space-y-5" data-testid="gateway-usage">
      <Button
        variant="outline"
        size="sm"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t('com_gateway_refresh')}
      </Button>
      {query.isLoading && <p role="status">{t('com_gateway_loading')}</p>}
      {query.isError && <p role="alert">{t('com_gateway_error')}</p>}
      {data && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                ['com_gateway_balance', data.wallet.balance],
                ['com_gateway_available', data.wallet.available],
                ['com_gateway_reserved', data.wallet.reserved],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="border-border-light rounded-xl border p-3">
                <dt className="text-text-secondary text-xs">{t(key)}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{count(value)}</dd>
              </div>
            ))}
          </dl>
          <p>
            {t('com_gateway_requests')}: <strong>{count(data.totals.requests)}</strong> ·{' '}
            {t('com_gateway_tokens')}: <strong>{count(data.totals.tokens)}</strong>
          </p>
          {Number(data.totals.uncertain) > 0 && <p role="alert">{t('com_gateway_holds')}</p>}
          <h4 className="font-semibold">{t('com_gateway_limits')}</h4>
          {data.limits.windows.map((w) => (
            <div key={w.window} className="border-border-light rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{t(`com_gateway_${w.window}`)}</strong>
                <span>
                  {t('com_gateway_remaining_percent', { 0: remainingPercentage(w).toFixed(2) })}
                </span>
                <span className="tabular-nums">
                  {count(w.used)} / {count(w.limit)}
                </span>
              </div>
              <progress
                className="bp-token-progress my-3 h-2.5 w-full"
                max={100}
                value={remainingPercentage(w)}
                aria-label={t(`com_gateway_${w.window}`)}
              />
              <p className="text-text-secondary text-xs">
                {t('com_gateway_available')}: {count(w.available)} · {t('com_gateway_reserved')}:{' '}
                {count(w.reserved)}
              </p>
              <p className="text-text-secondary mt-1 text-xs">
                {t('com_gateway_reset')}: {date(w.reset_at)}
              </p>
            </div>
          ))}
          <h4 className="font-semibold">{t('com_gateway_models')}</h4>
          <div className="flex flex-wrap gap-2">
            {data.offers.map((o) => (
              <code
                key={o.id}
                className="bg-surface-secondary max-w-full rounded px-2 py-1 text-xs break-all"
              >
                {o.id}
              </code>
            ))}
          </div>
          <h4 className="font-semibold">{t('com_gateway_model_usage')}</h4>
          {data.models.length === 0 ? (
            <p>{t('com_gateway_empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr>
                    <th className="text-start">{t('com_gateway_model_label')}</th>
                    <th>{t('com_gateway_requests')}</th>
                    <th>{t('com_gateway_tokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.model} className="border-border-light border-t">
                      <td className="py-2 break-all">{m.model}</td>
                      <td className="text-center">{count(m.requests)}</td>
                      <td className="text-center">{count(m.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
