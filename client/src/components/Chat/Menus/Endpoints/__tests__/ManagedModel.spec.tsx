import { fireEvent, render, screen } from '@testing-library/react';
import AddMultiConvo from '../../../AddMultiConvo';
import ModelSelector from '../ModelSelector';
import PresetsMenu from '../../PresetsMenu';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

test('keeps managed model, presets and comparison controls locked without offering ignored choices', () => {
  render(
    <>
      <ModelSelector startupConfig={undefined} managedLabel="Meeting copilot" />
      <PresetsMenu disabledReason="Managed meeting configuration" />
      <AddMultiConvo disabledReason="Model comparison unavailable" />
    </>,
  );
  const selector = screen.getByTestId('model-selector-button');
  expect(selector).toHaveTextContent('Meeting copilot');
  for (const control of [
    selector,
    screen.getByTestId('presets-button'),
    screen.getByTestId('add-multi-convo-button'),
  ]) {
    expect(control).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(control);
  }
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
