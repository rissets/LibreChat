import React, { useState, useEffect } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, Label, Spinner } from '@librechat/client';
import { Building2, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import type { TOnboardingProfileResponse } from 'librechat-data-provider';
import { useCompleteOnboardingMutation } from '~/data-provider';

interface OnboardingModalProps {
  open: boolean;
  profile?: TOnboardingProfileResponse;
}

export default function OnboardingModal({ open, profile }: OnboardingModalProps) {
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      if (profile.name) {
        setName(profile.name);
      }
      if (profile.department_id) {
        setDepartmentId(profile.department_id);
      }
    }
  }, [profile]);

  const completeMutation = useCompleteOnboardingMutation({
    onError: (error: unknown) => {
      const err = error as {
        response?: { data?: { code?: string; message?: string } };
        code?: string;
        message?: string;
      };
      const code = err?.response?.data?.code || err?.code || 'ONBOARDING_ERROR';
      if (code === 'DEPARTMENT_LOCKED') {
        setErrorMessage('Departemen telah dikunci oleh administrator dan tidak dapat diubah.');
      } else if (code === 'INVALID_DEPARTMENT') {
        setErrorMessage('Departemen yang dipilih tidak valid atau tidak aktif.');
      } else {
        setErrorMessage(
          err?.response?.data?.message ||
            err?.message ||
            'Gagal menyelesaikan onboarding. Silakan coba kembali atau hubungi administrator.',
        );
      }
    },
    onSuccess: () => {
      setErrorMessage(null);
    },
  });

  const isLocked = Boolean(profile?.department_locked);
  const effectiveDepartmentId = isLocked ? profile?.department_id || '' : departmentId;
  const isSubmitDisabled = !name.trim() || !effectiveDepartmentId || completeMutation.isLoading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) {
      return;
    }
    setErrorMessage(null);
    completeMutation.mutate({
      department_id: effectiveDepartmentId,
      name: name.trim() || undefined,
    });
  };

  if (!profile) {
    return null;
  }

  return (
    <OGDialog open={open} onOpenChange={() => undefined}>
      <OGDialogTemplate
        title="Siapkan akun Anda"
        description="Periksa profil dan departemen Anda sebelum mulai menggunakan BP Batam AI."
        className="w-[calc(100%-2rem)] max-w-xl"
        headerClassName="space-y-2"
        mainClassName="max-h-[65dvh] overflow-y-auto"
        showCloseButton={false}
        showCancelButton={false}
        main={
          <form id="onboarding-form" onSubmit={handleSubmit} className="space-y-6 py-2 text-sm">
            {errorMessage && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-text-primary">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}
            <section aria-labelledby="onboarding-account-heading">
              <h3 id="onboarding-account-heading" className="text-sm font-semibold text-text-primary">Akun yang digunakan</h3>
              <dl className="mt-3 divide-y divide-border-light rounded-xl bg-surface-secondary px-4">
                {profile.username && (
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="text-text-secondary">Username</dt>
                    <dd className="break-all font-medium text-text-primary sm:text-right">{profile.username}</dd>
                  </div>
                )}
                {profile.email && (
                  <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="text-text-secondary">{profile.email_verified ? 'Email terverifikasi' : 'Email'}</dt>
                    <dd className="break-all font-medium text-text-primary sm:text-right">{profile.email}</dd>
                  </div>
                )}
              </dl>
            </section>
            <div className="space-y-2">
              <Label htmlFor="onboarding-name" className="text-sm font-semibold">Nama lengkap</Label>
              <Input
                id="onboarding-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masukkan nama lengkap Anda"
                disabled={completeMutation.isLoading}
                autoComplete="name"
                required
              />
              <p className="text-xs leading-relaxed text-text-secondary">Nama ini akan ditampilkan pada profil Anda.</p>
            </div>
            <div className="space-y-2">
              {isLocked ? (
                <>
                  <p className="text-sm font-semibold text-text-primary">Departemen</p>
                  <div className="flex items-start gap-3 rounded-xl bg-surface-secondary p-4">
                    <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-text-primary">{profile.department_name || profile.department_id}</p>
                      <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-text-secondary">
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        Ditetapkan oleh administrator. Hubungi administrator jika perlu diubah.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Label htmlFor="onboarding-department" className="text-sm font-semibold">Departemen</Label>
                  <select
                    id="onboarding-department"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    disabled={completeMutation.isLoading}
                    aria-describedby="onboarding-department-help"
                    className="w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  >
                    <option value="" disabled>Pilih departemen Anda</option>
                    {(profile.departments || []).map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  <p id="onboarding-department-help" className="text-xs leading-relaxed text-text-secondary">
                    Tidak menemukan departemen Anda? Hubungi administrator.
                  </p>
                </>
              )}
            </div>
            <p className="border-t border-border-light pt-4 text-xs leading-relaxed text-text-secondary">
              Departemen langsung mengaktifkan hak akses member yang berlaku dan dicatat untuk pemeriksaan administrator.
            </p>
          </form>
        }
        buttons={
          <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              form="onboarding-form"
              variant="submit"
              disabled={isSubmitDisabled}
              className="flex items-center justify-center gap-2"
            >
              {completeMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              <span>{completeMutation.isLoading ? 'Menyimpan...' : 'Simpan dan lanjutkan'}</span>
              {!completeMutation.isLoading && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        }
      />
    </OGDialog>
  );
}
