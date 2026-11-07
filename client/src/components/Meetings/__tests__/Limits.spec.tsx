import { render, screen } from '@testing-library/react';
import Limits from '../Limits';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

test('clamps the progress indicator while keeping the duration warning visible', () => {
  render(
    <Limits
      value={{
        duration_limit_seconds: 60,
        duration_source: 'applied_policy',
        technical_max_seconds: 120,
        observed_seconds: 90,
        slot_held: false,
        slot_expires_at: null,
        error_code: 'MEETING_DURATION_LIMIT',
        policies: [],
      }}
    />,
  );

  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '60');
  expect(screen.getByRole('alert')).toHaveTextContent('com_meeting_duration_reached');
});
