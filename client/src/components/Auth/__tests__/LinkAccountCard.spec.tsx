import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkAccountCard from '../LinkAccountCard';

const mockMutate = jest.fn();

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type,
    className,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  ),
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    disabled,
    type,
    className,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  ),
  Spinner: ({ className }: { className?: string }) => (
    <div data-testid="spinner" className={className} />
  ),
}), { virtual: true });

jest.mock('~/data-provider', () => ({
  useLinkOpenIdMutation: (options: { onSuccess?: () => void; onError?: (err: unknown) => void }) => ({
    mutate: (payload: { password: string }) => {
      mockMutate(payload);
      if (payload.password === 'wrong-password') {
        options?.onError?.({
          response: { data: { message: 'INCORRECT_PASSWORD', attemptsRemaining: 4 } },
        });
      } else if (payload.password === 'cp-down') {
        options?.onError?.({ response: { data: { message: 'CONTROL_PANEL_UNAVAILABLE' } } });
      } else if (payload.password === 'expired-token') {
        options?.onError?.({ response: { data: { message: 'LINK_TOKEN_EXPIRED_OR_INVALID' } } });
      } else {
        options?.onSuccess?.();
      }
    },
    isLoading: false,
  }),
}), { virtual: true });

describe('LinkAccountCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title, description, and password input', () => {
    render(<LinkAccountCard />);
    expect(screen.getByText('Tautkan Akun Lokal dengan B-Pass')).toBeInTheDocument();
    expect(
      screen.getByText(/Akun lokal dengan email yang sama ditemukan/i),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Masukkan password akun lokal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tautkan Akun' })).toBeInTheDocument();
  });

  it('requires password input before submitting', async () => {
    render(<LinkAccountCard />);
    const submitBtn = screen.getByRole('button', { name: 'Tautkan Akun' });
    expect(submitBtn).toBeDisabled();
  });

  it('submits password and triggers onSuccess when correct', async () => {
    const handleSuccess = jest.fn();
    render(<LinkAccountCard onSuccess={handleSuccess} />);
    const input = screen.getByPlaceholderText('Masukkan password akun lokal');
    await userEvent.type(input, 'secret123');

    const submitBtn = screen.getByRole('button', { name: 'Tautkan Akun' });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    expect(mockMutate).toHaveBeenCalledWith({ password: 'secret123' });
    expect(handleSuccess).toHaveBeenCalled();
  });

  it('shows error alert on incorrect password', async () => {
    render(<LinkAccountCard />);
    const input = screen.getByPlaceholderText('Masukkan password akun lokal');
    await userEvent.type(input, 'wrong-password');

    fireEvent.click(screen.getByRole('button', { name: 'Tautkan Akun' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Password.*salah/i);
    });
  });
  it('shows service unavailable message when Control Panel is down', async () => {
    render(<LinkAccountCard />);
    const input = screen.getByPlaceholderText('Masukkan password akun lokal');
    await userEvent.type(input, 'cp-down');

    fireEvent.click(screen.getByRole('button', { name: 'Tautkan Akun' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Layanan manajemen identitas sedang tidak dapat dihubungi/i,
      );
    });
  });

  it('triggers onCancel when Batal is clicked', async () => {
    const handleCancel = jest.fn();
    render(<LinkAccountCard onCancel={handleCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(handleCancel).toHaveBeenCalled();
  });
});
