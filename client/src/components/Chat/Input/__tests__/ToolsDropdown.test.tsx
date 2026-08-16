import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolsDropdown from '../ToolsDropdown';

const mockDebouncedChange = jest.fn();
const mockSetPinned = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => false,
  useAuthContext: () => ({ user: undefined }),
  useHasMemoryAccess: () => false,
  useAgentCapabilities: () => ({
    codeEnabled: false,
    memoryEnabled: false,
    webSearchEnabled: false,
    artifactsEnabled: false,
    fileSearchEnabled: false,
    skillsEnabled: false,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
}));

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    imageGeneration: {
      toggleState: true,
      debouncedChange: mockDebouncedChange,
      isPinned: false,
      setIsPinned: mockSetPinned,
    },
  }),
}));

jest.mock('@ariakit/react', () => ({
  MenuButton: ({ render, ...props }: { render?: React.ReactElement } & React.ComponentProps<'button'>) =>
    render ? React.cloneElement(render, props) : <button {...props} />,
}));

jest.mock('@librechat/client', () => ({
  DropdownPopup: ({ trigger, items }: {
    trigger: React.ReactNode;
    items: Array<{ onClick?: () => void; render?: (props: object) => React.ReactNode }>;
  }) => (
    <div>
      {trigger}
      <div role="menu">
        {items.map((item, index) => (
          <div key={index} onClick={item.onClick}>{item.render?.({})}</div>
        ))}
      </div>
    </div>
  ),
  PinIcon: () => <span aria-hidden="true" />,
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
  VectorIcon: () => null,
}));

describe('ToolsDropdown image generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('always shows image generation and starts enabled by default', () => {
    render(<ToolsDropdown />);

    const item = screen.getByTestId('tools-menu-image-generation');
    expect(item).toBeVisible();
    expect(item).toHaveAttribute('aria-checked', 'true');
  });

  it('enables image generation when its menu item is clicked', () => {
    render(<ToolsDropdown />);

    fireEvent.click(screen.getByTestId('tools-menu-image-generation'));

    expect(mockDebouncedChange).toHaveBeenCalledWith({ value: false });
  });

  it('toggles the image generation pin without toggling the tool', () => {
    render(<ToolsDropdown />);

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));

    expect(mockSetPinned).toHaveBeenCalledWith(true);
    expect(mockDebouncedChange).not.toHaveBeenCalled();
  });
});
