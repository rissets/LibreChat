import { useContext } from 'react';
import { TStartupConfig } from 'librechat-data-provider';
import { Dropdown, ThemeContext, ThemeSelector } from '@librechat/client';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { hasPublishedPolicies } from '~/utils/policies';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import BrandLogo from '~/components/ui/BrandLogo';
import { BlinkAnimation } from './BlinkAnimation';
import { cn, DEFAULT_APP_TITLE } from '~/utils';
import LegalConsent from './LegalConsent';
import { Banner } from '../Banners';
import Footer from './Footer';
import './auth-shell.css';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
  language = 'en-US',
  onLanguageChange,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
  language?: string;
  onLanguageChange?: (language: string) => void;
}) {
  const localize = useLocalize();
  const { resolvedMode, highContrast } = useContext(ThemeContext);

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const isRegister = pathname.includes('register');
  const isLogin = !pathname.includes('2fa') && pathname.includes('login');
  const showsSocialLogin = isLogin || isRegister;
  /** Both ways in state it, rather than the layout guessing which of them can
   *  create an account. That guess is not available here: account creation
   *  also happens on a first provider sign-in, on a first LDAP sign-in through
   *  the ordinary form, and is gated server-side by ALLOW_SOCIAL_REGISTRATION,
   *  which the startup payload does not carry. The sentence is about
   *  continuing, which is what both screens do, and it names the same policies
   *  the footer bar linked, so a screen states them once. */
  const hasPolicies = hasPublishedPolicies(startupConfig);
  /** Registration states it under its own submit button, where it is read
   *  before the account is created rather than below however many provider
   *  buttons a deployment configured, and it renders that form only once the
   *  config has loaded without error. The login screen has no submit button of
   *  its own to sit under, so there the layout states it below the providers,
   *  for as long as it knows the policies: a background refetch must not swap
   *  the sentence for the bar and back. */
  const registrationStatesConsent =
    isRegister && hasPolicies && !hasStartupConfigError && !isFetching;
  const statesConsentBelowProviders = isLogin && hasPolicies;
  /** The bar is dropped exactly when the sentence is on the screen, so a
   *  reader never meets both and never meets neither. */
  const statesConsent = registrationStatesConsent || statesConsentBelowProviders;
  const isTwoFactorSetup = pathname === '/login/2fa/setup';
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a
              className="text-accent-primary font-semibold hover:underline"
              href="/forgot-password"
            >
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  /* These classes are imported from auth-shell.css and shared verbatim with the
   * Keycloak FreeMarker renderer, which cannot consume React/Tailwind primitives. */
  /* eslint-disable shadcn/no-unknown-classes, shadcn/no-restyle -- Cross-renderer authentication shell; styles are supplied by the imported CSS. */
  return (
    <div
      className="bp-auth-page"
      data-bp-theme={resolvedMode}
      data-bp-contrast={highContrast ? 'high' : 'normal'}
    >
      <Banner />
      <div className="bp-auth-layout">
        <aside data-testid="auth-artwork" aria-hidden="true" className="bp-auth-story">
          <img
            src="/brand/auth-maritime-v1.webp"
            alt=""
            width={1024}
            height={1536}
            className="bp-auth-artwork"
          />
          <div className="bp-auth-story-copy">
            <h2>{localize('com_auth_bp_story_title')}</h2>
            <p>{localize('com_auth_bp_story_description')}</p>
          </div>
          <div className="bp-auth-story-caption">{localize('com_auth_bp_story_caption')}</div>
        </aside>
        <header className="bp-auth-header">
          <BlinkAnimation active={isFetching}>
            <BrandLogo className="bp-auth-brand" />
          </BlinkAnimation>
          <div className="bp-auth-utilities">
            {onLanguageChange && (
              <Dropdown
                value={language.startsWith('id') ? 'id-ID' : 'en-US'}
                options={[
                  { value: 'id-ID', label: 'Indonesia' },
                  { value: 'en-US', label: 'English' },
                ]}
                onChange={onLanguageChange}
                ariaLabel={localize('com_nav_language')}
                className="bp-auth-language"
                triggerClassName="bp-auth-language-trigger"
                sizeClasses="bp-auth-language-menu"
                portal={false}
                variant="compact"
                renderValue={(option) => (
                  <>
                    <span className="bp-auth-language-full">{option.label}</span>
                    <span className="bp-auth-language-short">
                      {option.value === 'id-ID' ? 'ID' : 'EN'}
                    </span>
                  </>
                )}
              />
            )}
            <div className="bp-auth-appearance">
              <ThemeSelector inline />
            </div>
          </div>
        </header>
        <main className={cn('bp-auth-main', isTwoFactorSetup && 'bp-auth-main-wide')}>
          <div className="bp-auth-content">
            <DisplayError />
            {!hasStartupConfigError && !isFetching && header && (
              <>
                <h1 className="bp-auth-heading">{header}</h1>
                {isLogin && <p className="bp-auth-intro">{localize('com_auth_bp_login_intro')}</p>}
              </>
            )}
            {children}
            {showsSocialLogin && (
              <SocialLoginRender startupConfig={startupConfig} showPasskey={isLogin} />
            )}
            {statesConsentBelowProviders && <LegalConsent startupConfig={startupConfig} />}
          </div>
        </main>
        <footer className="bp-auth-footer">
          <span>{DEFAULT_APP_TITLE}</span>
          <Footer startupConfig={startupConfig} showPolicies={!statesConsent} />
        </footer>
      </div>
    </div>
  );
  /* eslint-enable shadcn/no-unknown-classes, shadcn/no-restyle */
}

export default AuthLayout;
