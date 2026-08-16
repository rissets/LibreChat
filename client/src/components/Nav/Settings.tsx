import type { TDialogProps } from '~/common';
import type { SettingsTab } from './Settings/types';
import { SettingsDialog } from './Settings/index';

export default function Settings(props: TDialogProps & { initialTab?: SettingsTab }) {
  return <SettingsDialog {...props} />;
}
