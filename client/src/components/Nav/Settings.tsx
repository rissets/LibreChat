import { lazy, Suspense, useEffect } from 'react';
import type { SettingsTab } from './Settings/types';
import { atom, useAtom } from 'jotai';

export const settingsOpenAtom = atom(false);
export const settingsTabAtom = atom<SettingsTab>('general' as SettingsTab);

/** Keep settings lazy without tying its lifetime to a responsive account-menu trigger. */
const SettingsDialog = lazy(() => import('./Settings/Dialog'));

export default function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);

  useEffect(() => () => setOpen(false), [setOpen]);

  return open ? (
    <Suspense fallback={null}>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </Suspense>
  ) : null;
}
