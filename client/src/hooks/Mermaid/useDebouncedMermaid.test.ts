import { renderHook } from '@testing-library/react';
import { useDebouncedMermaid } from './useDebouncedMermaid';

const mockUseMermaid = jest.fn();

jest.mock('./useMermaid', () => ({
  useMermaid: (options: unknown) => mockUseMermaid(options),
}));

describe('useDebouncedMermaid', () => {
  beforeEach(() => {
    mockUseMermaid.mockReset();
    mockUseMermaid.mockReturnValue({
      svg: undefined,
      isLoading: false,
      error: undefined,
      isValidating: false,
    });
  });

  it('keeps Mermaid disabled until a streamed diagram is renderable', () => {
    renderHook(() => useDebouncedMermaid({ content: 'graph TD' }));

    expect(mockUseMermaid).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: '', enabled: false }),
    );
  });
});
