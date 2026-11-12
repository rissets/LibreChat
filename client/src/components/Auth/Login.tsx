import { useEffect, useState } from 'react';
import { OpenIDIcon, useToastContext } from '@librechat/client';
import { ErrorTypes, registerPage } from 'librechat-data-provider';
import { useOutletContext, useSearchParams, useLocation } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import type { TranslationKeys } from '~/hooks';
import { getLoginError, persistRedirectToSession } from '~/utils';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import SocialButton from '~/components/Auth/SocialButton';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import LinkAccountCard from './LinkAccountCard';

interface LoginLocationState {
  redirect_to?: string;
}

/** Error codes the server appends to the login redirect when an OAuth navigation is rejected. */
const oauthErrorKeys: Record<string, TranslationKeys> = {
  [ErrorTypes.AUTH_FAILED]: 'com_auth_error_oauth_failed',
  [ErrorTypes.AUTH_RATE_LIMITED]: 'com_auth_error_login_rl',
  [ErrorTypes.AUTH_BANNED]: 'com_auth_error_login_ban',
};

function Login() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { error } = useAuthContext();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const disableAutoRedirect = searchParams.get('redirect') === 'false';

  const isLinkRequired = searchParams.get('link') === 'required';

  const handleCancelLink = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('link');
    setSearchParams(newParams, { replace: true });
  };
  const [isAutoRedirectDisabled, setIsAutoRedirectDisabled] = useState(disableAutoRedirect);

  useEffect(() => {
    const redirectTo = searchParams.get('redirect_to');
    if (redirectTo) {
      persistRedirectToSession(redirectTo);
    } else {
      const state = location.state as LoginLocationState | null;
      if (state?.redirect_to) {
        persistRedirectToSession(state.redirect_to);
      }
    }

    const oauthError = searchParams?.get('error');
    /** `hasOwn` keeps an attacker-supplied `?error=toString` off the prototype chain. */
    const oauthErrorKey =
      oauthError != null && Object.hasOwn(oauthErrorKeys, oauthError)
        ? oauthErrorKeys[oauthError]
        : undefined;
    if (oauthErrorKey != null) {
      showToast({
        message: localize(oauthErrorKey),
        status: 'error',
      });
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('error');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast, localize, location.state]);

  useEffect(() => {
    if (disableAutoRedirect) {
      setIsAutoRedirectDisabled(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('redirect');
      setSearchParams(newParams, { replace: true });
    }
  }, [disableAutoRedirect, searchParams, setSearchParams]);

  const shouldAutoRedirect =
    startupConfig?.openidLoginEnabled &&
    startupConfig?.openidAutoRedirect &&
    startupConfig?.serverDomain &&
    !isAutoRedirectDisabled &&
    !isLinkRequired;

  useEffect(() => {
    if (shouldAutoRedirect) {
      console.log('Auto-redirecting to OpenID provider...');
      window.location.href = `${startupConfig.serverDomain}/oauth/openid`;
    }
  }, [shouldAutoRedirect, startupConfig]);

  if (shouldAutoRedirect) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="text-lg font-semibold">
          {localize('com_ui_redirecting_to_provider', { 0: startupConfig.openidLabel })}
        </p>
        <div className="mt-4">
          <SocialButton
            key="openid"
            enabled={startupConfig.openidLoginEnabled}
            serverDomain={startupConfig.serverDomain}
            oauthPath="openid"
            Icon={() =>
              startupConfig.openidImageUrl ? (
                <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
              ) : (
                <OpenIDIcon />
              )
            }
            label={startupConfig.openidLabel}
            id="openid"
          />
        </div>
      </div>
    );
  }

  const serverDomain = startupConfig?.serverDomain?.replace(/\/+$/, '') ?? '';
  const bPassUrl = serverDomain
    ? `${serverDomain}/oauth/openid/b-pass`
    : '/oauth/openid/b-pass';

  const bPassLocalized = localize('com_auth_bpass_login');
  const bPassLabel =
    !bPassLocalized || bPassLocalized === 'com_auth_bpass_login' ? 'B-Pass' : bPassLocalized;

  const localLocalized = localize('com_auth_bpbatam_local_login');
  const localLoginLabel =
    !localLocalized || localLocalized === 'com_auth_bpbatam_local_login'
      ? 'BP Batam username/password'
      : localLocalized;


  return (
    <>
      {error != null && <ErrorMessage>{localize(getLoginError(error))}</ErrorMessage>}
      {isLinkRequired ? (
        <LinkAccountCard
          onCancel={handleCancelLink}
          onSuccess={() => {
            window.location.href = '/';
          }}
        />
      ) : (
        <>
          <div className="mt-4 space-y-3">
            <a
              href={bPassUrl}
              data-testid="bpass-login"
              aria-label={bPassLabel}
              className="border-border-light bg-surface-primary text-text-primary hover:bg-surface-tertiary focus-visible:ring-text-primary flex w-full items-center justify-center space-x-3 rounded-2xl border px-5 py-3 font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
            >
              <OpenIDIcon />
              <span>{bPassLabel}</span>
            </a>
            <a
              href={`${serverDomain}/oauth/openid`}
              data-testid="local-login"
              aria-label={localLoginLabel}
              className="border-border-light bg-surface-primary text-text-primary hover:bg-surface-tertiary focus-visible:ring-text-primary flex w-full items-center justify-center space-x-3 rounded-2xl border px-5 py-3 font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span>{localLoginLabel}</span>
            </a>
          </div>
          {startupConfig?.registrationEnabled === true && (
            <p className="text-text-secondary my-4 text-center text-sm font-light">
              {' '}
              {localize('com_auth_no_account')}{' '}
              <a
                href={registerPage()}
                className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover inline-flex p-1 text-sm font-medium underline decoration-transparent transition-all duration-200"
              >
                {localize('com_auth_sign_up')}
              </a>
            </p>
          )}
        </>
      )}
    </>
  );
}

export default Login;
