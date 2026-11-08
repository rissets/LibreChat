import { useContext, useId, useRef, useState } from 'react';
import { CheckCircle2, Coins, Send } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTrigger,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { useGatewayTokenRequests, useRequestGatewayTokens } from '~/data-provider/Gateway';
import { AuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

export function TokenRequestButton() {
  const user = useContext(AuthContext)?.user;
  return user?.provider === 'openid' ? <ManagedTokenRequestButton /> : null;
}
function ManagedTokenRequestButton() {
  const t = useLocalize();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('100000');
  const [reason, setReason] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const submit = useRequestGatewayTokens();
  return (
    <OGDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value && submit.isSuccess) {
          submit.reset();
          requestId.current = crypto.randomUUID();
          setReason('');
        }
      }}
    >
      <OGDialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1 self-start">
          <Send className="h-4 w-4" aria-hidden="true" />
          {t('com_gateway_request_tokens')}
        </Button>
      </OGDialogTrigger>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogHeader className="pr-6 text-left">
          <div className="bg-surface-secondary text-text-primary mb-3 flex h-11 w-11 items-center justify-center rounded-xl">
            <Coins className="h-5 w-5" aria-hidden="true" />
          </div>
          <OGDialogTitle className="text-lg font-semibold">
            {t('com_gateway_request_tokens')}
          </OGDialogTitle>
          <OGDialogDescription className="mt-1 leading-relaxed">
            {t('com_gateway_request_help')}
          </OGDialogDescription>
        </OGDialogHeader>
        {submit.isSuccess ? (
          <div className="space-y-5 pt-2">
            <p
              role="status"
              className="bg-surface-secondary text-text-primary flex items-start gap-3 rounded-xl p-4 text-sm leading-relaxed"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              {t('com_gateway_request_success')}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>{t('com_ui_close')}</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-5 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(amount);
              if (Number.isSafeInteger(value) && value > 0 && reason.trim().length >= 10)
                submit.mutate({
                  amount: value,
                  reason: reason.trim(),
                  request_id: requestId.current,
                });
            }}
          >
            <label htmlFor={id + '-amount'} className="block space-y-2">
              <span className="text-text-primary text-sm font-medium">
                {t('com_gateway_request_amount')}
              </span>
              <input
                id={id + '-amount'}
                className="bg-surface-primary border-border-medium text-text-primary focus-visible:ring-ring-primary w-full rounded-lg border px-3 py-2.5 tabular-nums outline-none focus-visible:ring-2"
                type="number"
                min="1"
                max={Number.MAX_SAFE_INTEGER}
                step="1"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label htmlFor={id + '-reason'} className="block space-y-2">
              <span className="text-text-primary text-sm font-medium">
                {t('com_gateway_request_reason')}
              </span>
              <textarea
                id={id + '-reason'}
                className="bg-surface-primary border-border-medium text-text-primary focus-visible:ring-ring-primary min-h-28 w-full resize-y rounded-lg border px-3 py-2.5 outline-none focus-visible:ring-2"
                minLength={10}
                maxLength={1000}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {submit.isError && (
              <p role="alert" className="text-text-primary text-sm">
                {t('com_gateway_mutation_error')}
              </p>
            )}
            <div className="border-border-light flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('com_ui_cancel')}
              </Button>
              <Button type="submit" disabled={submit.isLoading}>
                {submit.isLoading ? t('com_gateway_loading') : t('com_gateway_request_send')}
              </Button>
            </div>
          </form>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
export function TokenRequestHistory() {
  const t = useLocalize();
  const query = useGatewayTokenRequests();
  const [page, setPage] = useState(0);
  const rows = query.data?.requests ?? [];
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 5) - 1));
  const statusLabel = (status: string) => {
    if (status === 'requested') return t('com_gateway_request_pending');
    if (status === 'rejected') return t('com_gateway_request_rejected');
    if (status === 'allocated' || status === 'issued') return t('com_gateway_request_done');
    return status;
  };
  const renderHistory = () => {
    if (query.isLoading) return <p role="status">{t('com_gateway_loading')}</p>;
    if (query.isError)
      return (
        <div role="alert">
          <p>{t('com_gateway_error')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('com_gateway_refresh')}
          </Button>
        </div>
      );
    if (!rows.length)
      return <p className="text-text-secondary">{t('com_gateway_request_empty')}</p>;
    return (
      <>
        <ul className="divide-border-light divide-y">
          {rows.slice(current * 5, current * 5 + 5).map((row) => (
            <li key={row.id} className="space-y-1 py-3">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {Number(row.amount).toLocaleString()} {t('com_gateway_tokens')}
                </strong>
                <span>{statusLabel(row.status)}</span>
              </div>
              <p>{row.reason}</p>
              <small className="text-text-secondary">
                {new Date(row.created_at).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t('com_ui_prev')}
          </Button>
          <span>
            {current + 1} / {Math.max(1, Math.ceil(rows.length / 5))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(current + 1) * 5 >= rows.length}
            onClick={() => setPage(current + 1)}
          >
            {t('com_ui_next')}
          </Button>
        </div>
      </>
    );
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">{t('com_gateway_request_history')}</h4>
        <TokenRequestButton />
      </div>
      {renderHistory()}
    </section>
  );
}
