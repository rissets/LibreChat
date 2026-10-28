import { useContext, useId, useRef, useState } from 'react';
import { Send } from 'lucide-react';
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
        <Button variant="outline" size="sm">
          <Send className="h-4 w-4" aria-hidden="true" />
          {t('com_gateway_request_tokens')}
        </Button>
      </OGDialogTrigger>
      <OGDialogContent>
        <OGDialogHeader>
          <OGDialogTitle>{t('com_gateway_request_tokens')}</OGDialogTitle>
          <OGDialogDescription>{t('com_gateway_request_help')}</OGDialogDescription>
        </OGDialogHeader>
        {submit.isSuccess ? (
          <div className="space-y-4">
            <p role="status">{t('com_gateway_request_success')}</p>
            <Button onClick={() => setOpen(false)}>{t('com_ui_close')}</Button>
          </div>
        ) : (
          <form
            className="space-y-4"
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
              <span>{t('com_gateway_request_amount')}</span>
              <input
                id={id + '-amount'}
                className="bg-surface-primary border-border-light w-full rounded-lg border p-3"
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
              <span>{t('com_gateway_request_reason')}</span>
              <textarea
                id={id + '-reason'}
                className="bg-surface-primary border-border-light min-h-24 w-full rounded-lg border p-3"
                minLength={10}
                maxLength={1000}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {submit.isError && <p role="alert">{t('com_gateway_mutation_error')}</p>}
            <div className="flex justify-end gap-2">
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
