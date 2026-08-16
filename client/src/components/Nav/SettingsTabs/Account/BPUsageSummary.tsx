import { useBPAccessSnapshot } from '~/data-provider';

const WINDOWS = [
  ['5h', '5 jam'],
  ['weekly', 'Mingguan'],
  ['monthly', 'Bulanan'],
] as const;

export default function BPUsageSummary() {
  const { data, isLoading, isError } = useBPAccessSnapshot({ staleTime: 30_000 });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface-secondary" />;
  }
  if (isError) {
    return (
      <p className="text-sm text-red-500" role="alert">
        Ringkasan penggunaan belum dapat dimuat. Coba buka kembali pengaturan.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border-light bg-surface-secondary p-4">
      <div>
        <h3 className="font-medium text-text-primary">Penggunaan AI</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Batang menunjukkan kapasitas yang masih tersedia dan akan berkurang dari 100% ke 0%.
        </p>
      </div>
      <div className="space-y-3">
        {WINDOWS.map(([key, label]) => {
          const window = data?.quota?.windows?.[key];
          const remaining = window?.limit_tokens
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(((window.remaining_tokens ?? 0) / window.limit_tokens) * 100),
                ),
              )
            : 0;
          return (
            <div key={key}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-text-primary">{label}</span>
                <span className="text-text-secondary">{remaining}% tersisa</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-active-alt">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
                  style={{ width: `${remaining}%` }}
                  role="progressbar"
                  aria-label={`Kapasitas ${label}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={remaining}
                />
              </div>
              {window?.next_reset_at && (
                <p className="mt-1 text-xs text-text-tertiary">
                  Reset berikutnya {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(window.next_reset_at))}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
