import { useEffect, useState } from 'react';
import { useAuthContext } from '~/hooks/AuthContext';

type UsageWindow = {
  used_tokens: number;
  limit_tokens: number;
  remaining_tokens: number | null;
  next_reset_at?: string | null;
};

type UsageResponse = {
  quota?: { windows?: Record<'5h' | 'weekly' | 'monthly', UsageWindow> };
};

const WINDOW_LABELS = { '5h': '5 jam', weekly: 'Mingguan', monthly: 'Bulanan' } as const;

export default function AIUsage() {
  const { token } = useAuthContext();
  const [data, setData] = useState<UsageResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/bp-ai/access', {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => active && setData(payload))
      .catch(() => active && setData(null));
    return () => { active = false; };
  }, [token]);

  const windows = data?.quota?.windows;
  return (
    <div className="space-y-3" aria-label="Rincian penggunaan AI">
      <div><div className="font-medium text-text-primary">Penggunaan AI</div><p className="text-xs text-text-secondary">Batas terukur langsung dari kebijakan akun Anda.</p></div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(WINDOW_LABELS) as Array<keyof typeof WINDOW_LABELS>).map((key) => {
          const row = windows?.[key];
          const limit = row?.limit_tokens ?? 0;
          const remaining = row?.remaining_tokens ?? limit;
          const percent = limit > 0 ? Math.min(100, (remaining / limit) * 100) : 0;
          return <div key={key} className="rounded-xl border border-border-light bg-surface-secondary p-3">
            <div className="flex justify-between text-xs font-semibold"><span>{WINDOW_LABELS[key]}</span><span>{Math.round(percent)}% tersisa</span></div>
            <div className="my-2 h-2 overflow-hidden rounded-full bg-surface-active-alt"><div className="h-full rounded-full bg-blue-600" style={{ width: `${percent > 0 ? Math.max(1, percent) : 0}%` }} /></div>
            <div className="text-xs text-text-secondary">Bar berkurang saat penggunaan bertambah.</div>
          </div>;
        })}
      </div>
      <a className="flex w-full items-center justify-between rounded-xl border border-border-light bg-surface-secondary p-3 text-sm font-semibold hover:bg-surface-active-alt" href="http://accounts.bpai.localhost:8080/security/mfa/" target="_blank" rel="noreferrer">
        <span>Keamanan & MFA</span><span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
