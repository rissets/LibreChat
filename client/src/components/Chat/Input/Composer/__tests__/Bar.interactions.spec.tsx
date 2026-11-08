import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { ChipModes, ToolIcon } from '../Bar';
import type { PaletteEntry } from '~/hooks/Input/usePaletteEntries';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('ToolIcon', () => {
  it('opens an accessible menu to disable an active tool and select its mode', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const changeMode = jest.fn();
    const entry = {
      key: 'artifacts',
      itemType: 'tool',
      itemId: 'artifacts',
      label: 'Artifacts',
      icon: <span>icon</span>,
      section: 'tool',
      active: true,
      pinned: false,
      onSelect,
      modes: [{ id: 'default', label: 'Default', active: true, onSelect: changeMode }],
    } as PaletteEntry;
    render(<ToolIcon entry={entry} />);
    await user.click(screen.getByRole('button', { name: 'Artifacts' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    expect(changeMode).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('menuitem', { name: 'com_ui_remove_var' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('ChipModes', () => {
  it('keeps a portaled menu choice from reaching the composer', async () => {
    const user = userEvent.setup();
    const onComposerClick = jest.fn();
    const onSelect = jest.fn();
    render(
      <div onClick={onComposerClick}>
        <ChipModes modes={[{ id: 'high', label: 'High', active: false, onSelect }]} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'com_ui_mode' }));
    onComposerClick.mockClear();
    await user.click(screen.getByRole('menuitemradio', { name: 'High' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onComposerClick).not.toHaveBeenCalled();
  });
});
