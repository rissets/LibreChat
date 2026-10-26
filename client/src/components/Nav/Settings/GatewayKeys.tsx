import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  Label,
  OGDialog,
  OGDialogTrigger,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import {
  useGatewayAccount,
  useGatewayKeys,
  useCreateGatewayKey,
  useDeleteGatewayKey,
  useRevealGatewayKey,
  useRenameGatewayKey,
} from '~/data-provider/Gateway';
import { useLocalize } from '~/hooks';

function GatewayKeyManager() {
  const t = useLocalize();
  const account = useGatewayAccount();
  const query = useGatewayKeys();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [revealedId, setRevealedId] = useState('');
  const [search, setSearch] = useState('');
  const secretInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (secret) secretInput.current?.focus();
  }, [secret]);
  const [confirm, setConfirm] = useState('');
  const [copy, setCopy] = useState('');
  const [editing, setEditing] = useState('');
  const [editedName, setEditedName] = useState('');
  const command = useRef(crypto.randomUUID());
  const create = useCreateGatewayKey((value) => {
    setSecret(value.key);
    setRevealedId(value.key_id);
    setName('');
    command.current = crypto.randomUUID();
  });
  const remove = useDeleteGatewayKey();
  const reveal = useRevealGatewayKey((value) => {
    setSecret(value.key);
    setRevealedId(value.key_id);
    setCopy('');
  });
  const rename = useRenameGatewayKey();
  const base = account.data?.api_base_url;
  return (
    <div className="space-y-4" data-testid="gateway-keys">
      <div className="bg-surface-secondary border-border-light space-y-3 rounded-xl border p-4 text-sm">
        <p className="font-semibold">{t('com_gateway_connect_title')}</p>
        <p className="text-text-secondary">{t('com_gateway_connect_help')}</p>
        {base && (
          <dl className="space-y-3">
            <div>
              <dt className="text-text-secondary text-xs">{t('com_gateway_api_base')}</dt>
              <dd>
                <code className="break-all select-all">{base}</code>
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary text-xs">{t('com_gateway_auth_label')}</dt>
              <dd>{t('com_gateway_auth_help')}</dd>
            </div>
            <div>
              <dt className="text-text-secondary text-xs">{t('com_gateway_models')}</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {account.data?.offers
                  .filter((o) => o.capabilities.includes('chat'))
                  .map((o) => (
                    <code key={o.id} className="bg-surface-primary rounded-md px-2 py-1 text-xs">
                      {o.id}
                    </code>
                  ))}
              </dd>
            </div>
          </dl>
        )}
        <p className="text-text-secondary text-xs">{t('com_gateway_shared_limits')}</p>
      </div>
      {secret && (
        <div role="status" className="border-border-heavy space-y-3 rounded-xl border p-3">
          <p>{t('com_gateway_secret_help')}</p>
          <label htmlFor="gateway-secret">{t('com_gateway_key_label')}</label>
          <input
            ref={secretInput}
            id="gateway-secret"
            readOnly
            type="text"
            value={secret}
            autoComplete="off"
            spellCheck={false}
            className="bg-surface-primary border-border-light w-full rounded border p-2 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => setCopy(t('com_gateway_copied')))
                  .catch(() => setCopy(t('com_gateway_copy_error')));
              }}
            >
              {t('com_gateway_copy')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSecret('');
                setCopy('');
              }}
            >
              {t('com_gateway_dismiss')}
            </Button>
          </div>
          {copy && <p>{copy}</p>}
        </div>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim(), command_id: command.current });
        }}
      >
        <label htmlFor="gateway-key-name">{t('com_gateway_name')}</label>
        <input
          id="gateway-key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          disabled={create.isLoading}
          className="bg-surface-primary border-border-light w-full rounded-lg border px-3 py-2"
        />
        <Button type="submit" disabled={create.isLoading || !name.trim() || !!secret}>
          {create.isLoading ? t('com_gateway_creating') : t('com_gateway_create')}
        </Button>
      </form>
      {(create.isError || remove.isError || reveal.isError || rename.isError) && (
        <p role="alert">{t('com_gateway_mutation_error')}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t('com_gateway_active_keys')} ({query.data?.keys.length ?? 0})
        </h4>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('com_gateway_refresh')}
        </Button>
      </div>
      {query.isLoading && <p role="status">{t('com_gateway_loading')}</p>}
      {query.isError && <p role="alert">{t('com_gateway_error')}</p>}
      {query.data?.keys.length === 0 && (
        <div className="text-text-secondary flex flex-col items-center gap-3 py-8">
          <KeyRound className="h-8 w-8" aria-hidden="true" />
          <p>{t('com_gateway_no_keys')}</p>
        </div>
      )}
      {!!query.data?.keys.length && (
        <input
          type="search"
          aria-label={t('com_gateway_search_keys')}
          placeholder={t('com_gateway_search_keys')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-surface-primary border-border-light w-full rounded-lg border px-3 py-2"
        />
      )}
      <ul className="space-y-3">
        {query.data?.keys
          .filter((k) => (k.name + ' ' + k.key_prefix).toLowerCase().includes(search.toLowerCase()))
          .map((k) => (
            <li key={k.key_id} className="border-border-light space-y-2 rounded-xl border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="break-all">{k.name}</strong>
                <code>{k.key_prefix}…</code>
              </div>
              <p className="text-text-secondary text-xs">
                {t('com_gateway_created')}: {new Date(k.created_at).toLocaleString()}
              </p>
              <p className="text-xs">
                {t('com_gateway_requests')}: {k.requests.toLocaleString()} ·{' '}
                {t('com_gateway_tokens')}: {k.tokens.toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reveal.isLoading}
                  aria-label={t(
                    revealedId === k.key_id && secret
                      ? 'com_gateway_dismiss'
                      : 'com_gateway_view_key',
                  )}
                  title={t(
                    revealedId === k.key_id && secret
                      ? 'com_gateway_dismiss'
                      : 'com_gateway_view_key',
                  )}
                  onClick={() => {
                    if (revealedId === k.key_id && secret) {
                      setSecret('');
                      setRevealedId('');
                    } else reveal.mutate(k.key_id);
                  }}
                >
                  {revealedId === k.key_id && secret ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rename.isLoading}
                  aria-label={t('com_gateway_edit_key')}
                  title={t('com_gateway_edit_key')}
                  onClick={() => {
                    setEditing(k.key_id);
                    setEditedName(k.name);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              {editing === k.key_id && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate(
                      { id: k.key_id, name: editedName.trim() },
                      { onSuccess: () => setEditing('') },
                    );
                  }}
                >
                  <label htmlFor={'edit-key-' + k.key_id}>{t('com_gateway_name')}</label>
                  <input
                    id={'edit-key-' + k.key_id}
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    maxLength={100}
                    required
                    disabled={rename.isLoading}
                    className="bg-surface-primary border-border-light w-full rounded-lg border px-3 py-2"
                  />
                  <Button size="sm" type="submit" disabled={rename.isLoading || !editedName.trim()}>
                    {t('com_gateway_save_key')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={rename.isLoading}
                    onClick={() => setEditing('')}
                  >
                    {t('com_gateway_cancel')}
                  </Button>
                </form>
              )}
              {confirm === k.key_id ? (
                <div className="space-y-2">
                  <p>{t('com_gateway_confirm_delete')}</p>
                  <Button
                    size="sm"
                    disabled={remove.isLoading}
                    onClick={() =>
                      remove.mutate(k.key_id, {
                        onSuccess: () => {
                          setConfirm('');
                          setSecret('');
                        },
                      })
                    }
                  >
                    {t('com_gateway_confirm')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isLoading}
                    onClick={() => setConfirm('')}
                  >
                    {t('com_gateway_cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isLoading}
                  aria-label={t('com_gateway_delete')}
                  title={t('com_gateway_delete')}
                  onClick={() => setConfirm(k.key_id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

export default function GatewayKeys() {
  const t = useLocalize();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4" data-testid="gateway-key-management">
      <Label id="gateway-key-management-label">{t('com_gateway_keys')}</Label>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogTrigger asChild>
          <Button variant="outline" aria-labelledby="gateway-key-management-label">
            {t('com_ui_manage')}
          </Button>
        </OGDialogTrigger>
        {open && (
          <OGDialogContent className="w-11/12 max-w-3xl" aria-describedby={undefined}>
            <OGDialogHeader>
              <OGDialogTitle>{t('com_gateway_keys')}</OGDialogTitle>
            </OGDialogHeader>
            <div className="max-h-[70vh] overflow-y-auto px-1 pb-1">
              <GatewayKeyManager />
            </div>
          </OGDialogContent>
        )}
      </OGDialog>
    </div>
  );
}
