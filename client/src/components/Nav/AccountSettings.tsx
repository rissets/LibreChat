import { useState, memo, useRef, useEffect } from 'react';
import * as Menu from '@ariakit/react/menu';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import {
  Archive,
  FileText,
  LogOut,
} from 'lucide-react';
import { ArchivedChatsModal } from '~/components/Nav/SettingsTabs/General/ArchivedChatsModal';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import Settings from './Settings';

type BPAccessSummary = {
  models: Array<{ model: string; name: string }>;
  quota: {
    used_tokens: number;
    limit_tokens: number;
    remaining_tokens: number | null;
    windows?: Record<string, {
      used_tokens: number;
      limit_tokens: number;
      remaining_tokens: number | null;
    }>;
  };
};

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const { user, token, isAuthenticated, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [accessSummary, setAccessSummary] = useState<BPAccessSummary | null>(null);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessSummary(null);
      return;
    }

    let active = true;
    const loadAccessSummary = () =>
      fetch('/api/bp-ai/access', {
        credentials: 'same-origin',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: BPAccessSummary | null) => {
          if (active) {
            setAccessSummary(data);
          }
        })
        .catch(() => {
          if (active) {
            setAccessSummary(null);
          }
        });

    void loadAccessSummary();
    const refreshInterval = window.setInterval(loadAccessSummary, 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [isAuthenticated, token]);

  const fiveHour = accessSummary?.quota.windows?.['5h'];
  const quotaLimit = fiveHour?.limit_tokens ?? 0;
  const quotaRemaining = fiveHour?.remaining_tokens ?? quotaLimit;
  const quotaPercentExact = quotaLimit > 0 ? Math.min(100, (quotaRemaining / quotaLimit) * 100) : 0;
  const quotaPercentLabel = `${Math.round(quotaPercentExact)}% tersisa`;
  const quotaBarPercent = quotaPercentExact > 0 ? Math.max(1, quotaPercentExact) : 0;

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
        className="account-settings-popover popover-ui z-[125] w-[360px] max-w-[calc(100vw-24px)] rounded-xl"
        style={{
          transformOrigin: collapsed ? 'left bottom' : 'bottom',
          translate: collapsed ? '4px 0' : '0 -4px',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3" role="note">
          <img
            src="/assets/bp-batam.png"
            alt="BP Batam"
            className="h-10 w-[98px] flex-none object-contain object-left"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">BP Batam AI</div>
            <div className="truncate text-xs text-text-secondary">
              {user?.email ?? localize('com_nav_user')}
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        {accessSummary && (
          <>
            <div
              className="mx-3 my-3 rounded-xl border border-border-light bg-surface-secondary p-3 text-sm"
              role="status"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-text-primary">
                    {localize('com_nav_bp_usage')}
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {localize('com_nav_bp_quota_caption')}
                  </div>
                </div>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  {quotaPercentLabel}
                </span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-surface-active-alt">
                <div
                  className="h-full rounded-full bg-blue-700 transition-[width] dark:bg-blue-400"
                  style={{ width: `${quotaBarPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-text-secondary">Bar berkurang dari 100% ke 0% selama jendela 5 jam.</p>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <Menu.MenuItem onClick={() => setShowFiles(true)} className="select-item text-sm">
          <FileText className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Menu.MenuItem>
        <Menu.MenuItem onClick={() => setShowArchived(true)} className="select-item text-sm">
          <Archive className="icon-md" aria-hidden="true" />
          {localize('com_nav_archived_chats')}
        </Menu.MenuItem>
        <Menu.MenuItem
          onClick={() => setShowSettings(true)}
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
      {showSettings && <Settings open={showSettings} onOpenChange={setShowSettings} />}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
