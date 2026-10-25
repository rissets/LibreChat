import { TStartupConfig } from 'librechat-data-provider';
import { policyUrls } from '~/utils/policies';
import { useLocalize } from '~/hooks';

function Footer({
  startupConfig,
  showPolicies = true,
}: {
  startupConfig: TStartupConfig | null | undefined;
  showPolicies?: boolean;
}) {
  const localize = useLocalize();
  if (!startupConfig) {
    return null;
  }
  /** Read the way the consent reads them, so a blank url is not a policy on one
   *  screen and a link back to this page on another. */
  const { privacyPolicyUrl, termsOfServiceUrl } = policyUrls(startupConfig);

  const privacyPolicyRender = showPolicies && privacyPolicyUrl != null && (
    <a
      className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover text-sm underline decoration-transparent transition-all duration-200"
      href={privacyPolicyUrl}
      // Removed for WCAG compliance
      // target={privacyPolicy.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_privacy_policy')}
    </a>
  );

  const termsOfServiceRender = showPolicies && termsOfServiceUrl != null && (
    <a
      className="text-accent-primary hover:text-accent-primary-hover hover:decoration-accent-primary-hover focus:text-accent-primary-hover focus:decoration-accent-primary-hover text-sm underline decoration-transparent transition-all duration-200"
      href={termsOfServiceUrl}
      // Removed for WCAG compliance
      // target={termsOfService.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_terms_of_service')}
    </a>
  );

  return (
    <div className="m-4 flex flex-wrap justify-center gap-4" role="contentinfo">
      <a href="/brand/help.html">{localize('com_nav_help_faq')}</a>
      {privacyPolicyRender}
      {privacyPolicyRender && termsOfServiceRender && (
        <div className="border-border-medium border-e" />
      )}
      {termsOfServiceRender}
    </div>
  );
}

export default Footer;
