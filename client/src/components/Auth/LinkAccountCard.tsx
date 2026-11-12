import React, { useState } from 'react';
import { Button, Input, Spinner } from '@librechat/client';
import { useLinkOpenIdMutation } from '~/data-provider';

type TLinkAccountCardProps = {
  onSuccess?: () => void;
  onCancel?: () => void;
};

export const LinkAccountCard: React.FC<TLinkAccountCardProps> = ({ onSuccess, onCancel }) => {
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const linkMutation = useLinkOpenIdMutation({
    onSuccess: () => {
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = '/';
      }
    },
    onError: (err: unknown) => {
      const data = (err as {
        response?: { data?: { message?: string; attemptsRemaining?: number; detail?: string } };
      })?.response?.data;
      const msg = data?.message;
      if (msg === 'INCORRECT_PASSWORD') {
        const remaining = data?.attemptsRemaining;
        setErrorMessage(
          remaining != null
            ? `Password akun lokal salah. Sisa percobaan: ${remaining}. Pastikan Anda memasukkan password akun lokal yang benar.`
            : 'Password akun lokal salah. Silakan coba lagi.',
        );
      } else if (msg === 'MAX_ATTEMPTS_EXCEEDED') {
        setErrorMessage(
          data?.detail || 'Batas percobaan terlampaui. Silakan login kembali lewat B-Pass.',
        );
      } else if (msg === 'CONTROL_PANEL_UNAVAILABLE') {
        setErrorMessage(
          data?.detail ||
            'Layanan manajemen identitas sedang tidak dapat dihubungi. Silakan coba kembali dalam beberapa saat.',
        );
      } else if (msg === 'LINK_TOKEN_EXPIRED_OR_INVALID') {
        setErrorMessage('Sesi penautan telah kedaluwarsa. Silakan masuk kembali melalui SSO B-Pass.');
      } else {
        setErrorMessage('Gagal menautkan akun. Silakan coba lagi.');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Password wajib diisi.');
      return;
    }
    setErrorMessage(null);
    linkMutation.mutate({ password });
  };

  return (
    <div className="mb-6 rounded-xl border border-border-light bg-surface-primary p-6 shadow-sm dark:border-border-medium">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Tautkan Akun Lokal dengan B-Pass</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Akun lokal dengan email yang sama ditemukan. Masukkan password akun lokal Anda untuk membuktikan kepemilikan dan menautkan dengan B-Pass SSO tanpa kehilangan riwayat atau hak akun.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-text-primary">
            Password Akun Lokal
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Masukkan password akun lokal"
            disabled={linkMutation.isLoading}
            autoComplete="current-password"
            autoFocus
          />
        </div>

        {errorMessage && (
          <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={linkMutation.isLoading}
            >
              Batal
            </Button>
          )}
          <Button
            type="submit"
            variant="default"
            disabled={linkMutation.isLoading || !password}
          >
            {linkMutation.isLoading ? <Spinner className="h-4 w-4" /> : 'Tautkan Akun'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default LinkAccountCard;
