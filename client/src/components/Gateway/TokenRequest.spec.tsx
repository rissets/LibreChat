import { fireEvent, render, screen } from '@testing-library/react';
import { AuthContext } from '~/hooks/AuthContext';
import { TokenRequestButton, TokenRequestHistory } from './TokenRequest';

const mockMutate = jest.fn();
const mockUser = { provider: 'openid' };
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/hooks/AuthContext', () => ({
  AuthContext: jest.requireActual('react').createContext(undefined),
}));
jest.mock('~/data-provider/Gateway', () => ({
  useRequestGatewayTokens: () => ({
    mutate: mockMutate,
    isLoading: false,
    isSuccess: false,
    reset: jest.fn(),
  }),
  useGatewayTokenRequests: () => ({
    data: {
      requests: Array.from({ length: 6 }, (_, i) => ({
        id: String(i),
        amount: 1000,
        reason: 'Analysis request ' + i,
        status: 'requested',
        created_at: '2026-10-27T01:00:00Z',
      })),
    },
    isLoading: false,
    isError: false,
  }),
}));
afterEach(() => {
  mockMutate.mockClear();
  mockUser.provider = 'openid';
});
it('submits an amount and reason with an idempotency identity and no account selector', () => {
  render(
    <AuthContext.Provider value={{ user: mockUser } as React.ContextType<typeof AuthContext>}>
      <TokenRequestButton />
    </AuthContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'com_gateway_request_tokens' }));
  fireEvent.change(screen.getByLabelText('com_gateway_request_amount'), {
    target: { value: '2500' },
  });
  fireEvent.change(screen.getByLabelText('com_gateway_request_reason'), {
    target: { value: 'Additional analysis capacity' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'com_gateway_request_send' }).closest('form')!,
  );
  expect(mockMutate).toHaveBeenCalledWith({
    amount: 2500,
    reason: 'Additional analysis capacity',
    request_id: expect.any(String),
  });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('does not offer managed token requests to password-only users', () => {
  mockUser.provider = 'local';
  render(
    <AuthContext.Provider value={{ user: mockUser } as React.ContextType<typeof AuthContext>}>
      <TokenRequestButton />
    </AuthContext.Provider>,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('paginates the current user request history', () => {
  render(<TokenRequestHistory />);
  expect(screen.getByText('Analysis request 0')).toBeInTheDocument();
  expect(screen.queryByText('Analysis request 5')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_next' }));
  expect(screen.getByText('Analysis request 5')).toBeInTheDocument();
});

it('does not require an auth provider on shared error surfaces', () => {
  render(<TokenRequestButton />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
