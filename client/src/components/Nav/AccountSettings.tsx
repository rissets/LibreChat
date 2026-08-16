import { useState, memo, useRef } from 'react';
import { useSetRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import {
  Archive,
  BarChart3,
  ChevronRight,
  CircleHelp,
  FileText,
  Keyboard,
  LifeBuoy,
  LogOut,
  Scale,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { SettingsTabValues } from 'librechat-data-provider';
import type { SettingsTab } from './Settings/types';
import { ArchivedChatsModal } from '~/components/Nav/SettingsTabs/General/ArchivedChatsModal';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useBPAccessSnapshot, useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import Settings from './Settings';
import store from '~/store';

function HelpSubmenu({
  helpAndFaqURL,
  termsOfServiceURL,
  privacyPolicyURL,
  onShowShortcuts,
}: {
  helpAndFaqURL?: string;
  termsOfServiceURL?: string;
  privacyPolicyURL?: string;
  onShowShortcuts: () => void;
}) {
  const localize = useLocalize();
  const hasHelpFaq = !!helpAndFaqURL && helpAndFaqURL !== '/';
  const hasTos = !!termsOfServiceURL;
  const hasPrivacy = !!privacyPolicyURL;
  const showLegalDivider = (hasHelpFaq || true) && (hasTos || hasPrivacy);

  return (
    <Menu.MenuProvider placement="right-start">
      <Menu.MenuItem
        hideOnClick={false}
        render={
          <Menu.MenuButton className="select-item flex w-full cursor-pointer items-center gap-2 text-sm" />
        }
      >
        <CircleHelp className="icon-md" aria-hidden="true" />
        <span className="flex-1 text-left">{localize('com_nav_help')}</span>
        <ChevronRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
      </Menu.MenuItem>
      <Menu.Menu
        portal
        gutter={12}
        className="account-settings-popover popover-ui popover-from-left z-[126] w-[244px] rounded-lg"
      >
        {hasHelpFaq && (
          <Menu.MenuItem
            onClick={() => window.open(helpAndFaqURL, '_blank', 'noopener,noreferrer')}
            className="select-item text-sm"
          >
            <LifeBuoy className="icon-md" aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem onClick={onShowShortcuts} className="select-item text-sm">
          <Keyboard className="icon-md" aria-hidden="true" />
          {localize('com_shortcut_keyboard_shortcuts')}
        </Menu.MenuItem>
        {showLegalDivider && (hasTos || hasPrivacy) && <DropdownMenuSeparator />}
        {hasTos && (
          <Menu.MenuItem
            onClick={() => window.open(termsOfServiceURL, '_blank', 'noopener,noreferrer')}
            className="select-item text-sm"
          >
            <Scale className="icon-md" aria-hidden="true" />
            {localize('com_ui_terms_of_service')}
          </Menu.MenuItem>
        )}
        {hasPrivacy && (
          <Menu.MenuItem
            onClick={() => window.open(privacyPolicyURL, '_blank', 'noopener,noreferrer')}
            className="select-item text-sm"
          >
            <ShieldCheck className="icon-md" aria-hidden="true" />
            {localize('com_ui_privacy_policy')}
          </Menu.MenuItem>
        )}
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const { user, isAuthenticated, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const accessQuery = useBPAccessSnapshot({ enabled: !!isAuthenticated });
  const fiveHourWindow = accessQuery.data?.quota?.windows?.['5h'];
  const remainingPercent = fiveHourWindow?.limit_tokens
    ? Math.max(
        0,
        Math.min(100, Math.round(((fiveHourWindow.remaining_tokens ?? 0) / fiveHourWindow.limit_tokens) * 100)),
      )
    : null;
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(SettingsTabValues.GENERAL);
  const [showFiles, setShowFiles] = useState(false);
  const setShowShortcutsDialog = useSetRecoilState(store.showShortcutsDialog);
  const [showArchived, setShowArchived] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu.MenuProvider placement={collapsed ? 'right-end' : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={
          collapsed
            ? 'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
            : 'mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
        }
      >
        <div
          className={collapsed ? 'size-7 flex-shrink-0' : '-ml-0.9 -mt-0.8 h-8 w-8 flex-shrink-0'}
        >
          <div className="relative flex">
            <Avatar user={user} size={collapsed ? 28 : 32} />
          </div>
        </div>
        {!collapsed && (
          <div
            className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-primary"
            style={{ marginTop: '0', marginLeft: '0' }}
          >
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: collapsed ? 'left bottom' : 'bottom',
          translate: collapsed ? '4px 0' : '0 -4px',
        }}
      >
        <div className="mx-3 flex items-center gap-3 py-2" role="note">
          <img
            src="/assets/logo.svg"
            alt="Logo BP Batam"
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div className="min-w-0">
            <div className="font-semibold text-text-primary">BP Batam AI</div>
            <div className="truncate text-sm text-text-secondary">
              {user?.email ?? localize('com_nav_user')}
            </div>
          </div>
        </div>
        {remainingPercent != null && (
          <div className="mx-3 mb-3 rounded-lg border border-border-light p-3" role="status">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-text-primary">Kapasitas AI 5 jam</span>
              <span className="text-text-secondary">{remainingPercent}% tersisa</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-active-alt">
              <div
                className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
                style={{ width: `${remainingPercent}%` }}
              />
            </div>
          </div>
        )}
        <DropdownMenuSeparator />
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <HelpSubmenu
          helpAndFaqURL={startupConfig?.helpAndFaqURL}
          termsOfServiceURL={startupConfig?.interface?.termsOfService?.externalUrl}
          privacyPolicyURL={startupConfig?.interface?.privacyPolicy?.externalUrl}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
        />
        <Menu.MenuItem onClick={() => setShowFiles(true)} className="select-item text-sm">
          <FileText className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Menu.MenuItem>
        <Menu.MenuItem onClick={() => setShowArchived(true)} className="select-item text-sm">
          <Archive className="icon-md" aria-hidden="true" />
          {localize('com_nav_archived_chats')}
        </Menu.MenuItem>
        <Menu.MenuItem
          onClick={() => {
            setSettingsTab(SettingsTabValues.ACCOUNT);
            setShowSettings(true);
          }}
          className="select-item text-sm"
        >
          <BarChart3 className="icon-md" aria-hidden="true" />
          Penggunaan
        </Menu.MenuItem>
        <Menu.MenuItem
          onClick={() => {
            setSettingsTab(SettingsTabValues.ACCOUNT);
            setShowSettings(true);
          }}
          className="select-item text-sm"
        >
          <UserRound className="icon-md" aria-hidden="true" />
          Pengaturan akun
        </Menu.MenuItem>
        <Menu.MenuItem
          onClick={() => {
            setSettingsTab(SettingsTabValues.GENERAL);
            setShowSettings(true);
          }}
          className="select-item text-sm"
          data-testid="nav-settings"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
      {showFiles && (
        <MyFilesModal
          open={showFiles}
          onOpenChange={setShowFiles}
          triggerRef={accountSettingsButtonRef}
        />
      )}
      {showArchived && (
        <ArchivedChatsModal
          open={showArchived}
          onOpenChange={setShowArchived}
          triggerRef={accountSettingsButtonRef}
        />
      )}
      {showSettings && (
        <Settings open={showSettings} onOpenChange={setShowSettings} initialTab={settingsTab} />
      )}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
