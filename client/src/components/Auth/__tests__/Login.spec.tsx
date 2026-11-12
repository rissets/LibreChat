import * as reactRouter from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { TStartupConfig } from 'librechat-data-provider';
import { getByTestId, render, waitFor } from 'test/layout-test-utils';
import * as endpointQueries from '~/data-provider/Endpoints/queries';
import * as miscDataProvider from '~/data-provider/Misc/queries';
import * as authMutations from '~/data-provider/Auth/mutations';
import * as authQueries from '~/data-provider/Auth/queries';
import AuthLayout from '~/components/Auth/AuthLayout';
import Login from '~/components/Auth/Login';

jest.mock('librechat-data-provider/react-query');

const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const mockStartupConfig = {
  isFetching: false,
  isLoading: false,
  isError: false,
  data: {
    socialLogins: ['google', 'facebook', 'openid', 'github', 'discord', 'saml'],
    discordLoginEnabled: true,
    facebookLoginEnabled: true,
    githubLoginEnabled: true,
    googleLoginEnabled: true,
    openidLoginEnabled: true,
    openidLabel: 'Test OpenID',
    openidImageUrl: 'http://test-server.com',
    samlLoginEnabled: true,
    samlLabel: 'Test SAML',
    samlImageUrl: 'http://test-server.com',
    ldap: {
      enabled: false,
    },
    registrationEnabled: true,
    emailLoginEnabled: true,
    socialLoginEnabled: true,
    serverDomain: 'mock-server',
  },
};

const setup = ({
  useGetUserQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
  useLoginUserReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {},
    isSuccess: false,
  },
  useRefreshTokenMutationReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {
      token: 'mock-token',
      user: {},
    },
  },
  useGetStartupConfigReturnValue = mockStartupConfig,
  useGetBannerQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
} = {}) => {
  const mockUseLoginUser = jest
    .spyOn(authMutations, 'useLoginUserMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useLoginUserReturnValue);
  const mockUseGetUserQuery = jest
    .spyOn(authQueries, 'useGetUserQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetUserQueryReturnValue);
  const mockUseGetStartupConfig = jest
    .spyOn(endpointQueries, 'useGetStartupConfig')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetStartupConfigReturnValue);
  const mockUseRefreshTokenMutation = jest
    .spyOn(authMutations, 'useRefreshTokenMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useRefreshTokenMutationReturnValue);
  const mockUseGetBannerQuery = jest
    .spyOn(miscDataProvider, 'useGetBannerQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetBannerQueryReturnValue);
  const mockUseOutletContext = jest.spyOn(reactRouter, 'useOutletContext').mockReturnValue({
    startupConfig: useGetStartupConfigReturnValue.data,
  });
  const renderResult = render(
    <AuthLayout
      startupConfig={useGetStartupConfigReturnValue.data as TStartupConfig}
      isFetching={useGetStartupConfigReturnValue.isFetching}
      error={null}
      startupConfigError={null}
      header={'Welcome back'}
      pathname="login"
    >
      <Login />
    </AuthLayout>,
  );
  return {
    ...renderResult,
    mockUseLoginUser,
    mockUseGetUserQuery,
    mockUseOutletContext,
    mockUseGetStartupConfig,
    mockUseRefreshTokenMutation,
    mockUseGetBannerQuery,
  };
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  __esModule: true,
  useOutletContext: () => ({
    startupConfig: mockStartupConfig,
  }),
}));

test('renders accessible two-choice login view initially', () => {
  const { queryByLabelText, getByRole, queryByTestId } = setup();
  const bPassLink = getByRole('link', { name: /B-Pass/i });
  expect(bPassLink).toBeInTheDocument();
  expect(bPassLink).toHaveAttribute('href', 'mock-server/oauth/openid/b-pass');
  expect(getByRole('link', { name: /BP Batam username\/password/i })).toHaveAttribute('href', 'mock-server/oauth/openid');
  expect(queryByLabelText(/email/i)).not.toBeInTheDocument();
  expect(queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(queryByTestId('login-button')).not.toBeInTheDocument();
  expect(queryByTestId('passkey')).not.toBeInTheDocument();
  expect(getByRole('link', { name: /Sign up/i })).toHaveAttribute('href', '/register');
});


describe('OAuth rejection redirects', () => {
  const enterAt = (search: string) => {
    window.history.pushState({}, '', `/login${search}`);
  };

  afterEach(() => {
    mockShowToast.mockClear();
    window.history.pushState({}, '', '/login');
  });

  test.each([
    [
      'auth_rate_limited',
      'Too many login attempts in a short amount of time. Please try again later.',
    ],
    ['auth_banned', 'Your account has been temporarily banned due to violations of our service.'],
    ['auth_failed', 'Authentication failed. Please check your login method and try again.'],
  ])('surfaces a localized toast for %s and clears the query', async (code, message) => {
    enterAt(`?redirect=false&error=${code}`);

    setup();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith({ message, status: 'error' }));
    await waitFor(() => expect(window.location.search).not.toContain('error='));
    expect(window.location.search).not.toContain('redirect=');
  });

  test.each(['toString', 'constructor', 'unmapped_code'])(
    'ignores the unmapped error code %s',
    async (code) => {
      enterAt(`?error=${code}`);

      setup();

      await waitFor(() => expect(getByTestId(document.body, 'bpass-login')).toBeInTheDocument());
      expect(mockShowToast).not.toHaveBeenCalled();
    },
  );
});
