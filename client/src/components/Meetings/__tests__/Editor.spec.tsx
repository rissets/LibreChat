import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Editor from '../Editor';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

test('renders saved formatting and pastes document text through the real editor into Markdown', async () => {
  const save = jest.fn();
  render(<Editor value="**Agenda**" disabled={false} onChange={save} />);
  const editor = await screen.findByRole('textbox', { name: 'com_meeting_workspace_notes' });
  expect(editor.querySelector('strong')).toHaveTextContent('Agenda');
  expect(screen.getByRole('toolbar', { name: 'com_meeting_editor_toolbar' })).toBeVisible();
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => {
        if (type === 'text/html') return '<p><em>Copied note</em></p><script>unsafe()</script>';
        return type === 'text/plain' ? 'Copied note' : '';
      },
      types: ['text/html', 'text/plain'],
      files: [],
    },
  });
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(editor.querySelector('em')).toHaveTextContent('Copied note');
  expect(save.mock.lastCall[0]).toContain('Copied note');
  expect(save.mock.lastCall[0]).not.toContain('script');
  expect(editor.querySelector('script')).toBeNull();
});

test('keeps notes read only while unavailable and restores a received server draft', async () => {
  const save = jest.fn();
  const view = render(<Editor value="Server draft" disabled onChange={save} />);
  const editor = await screen.findByRole('textbox', { name: 'com_meeting_workspace_notes' });
  expect(editor).toHaveAttribute('contenteditable', 'false');
  view.rerender(<Editor value="## Restored heading" disabled={false} onChange={save} />);
  await waitFor(() =>
    expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'true'),
  );
  expect(screen.getByRole('textbox').querySelector('h2')).toHaveTextContent('Restored heading');
  expect(save).not.toHaveBeenCalled();
});

test('loading saved notes creates fresh undo history and cannot autosave an empty draft', async () => {
  const save = jest.fn();
  const view = render(<Editor value="" disabled onChange={save} />);
  view.rerender(<Editor value="**Previously saved notes**" disabled={false} onChange={save} />);
  await waitFor(() =>
    expect(screen.getByRole('textbox')).toHaveTextContent('Previously saved notes'),
  );
  expect(screen.getByRole('button', { name: 'com_meeting_editor_undo' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
