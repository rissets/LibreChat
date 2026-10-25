import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, renderHook } from '@testing-library/react';
import useTextToSpeechExternal from './useTextToSpeechExternal';
import useTextToSpeechBrowser from './useTextToSpeechBrowser';
import store from '~/store';

const mockSpeechSnapshot = { supported: true, voices: [] };
const mockShowToast = jest.fn();
const mockMutate = jest.fn();
let mockMutationOptions: {
  onError: (error: unknown, variables: FormData) => void;
};
jest.mock('~/utils', () => ({
  subscribeSpeechVoices: () => () => undefined,
  getSpeechVoicesSnapshot: () => mockSpeechSnapshot,
  getTTSCacheKey: jest.fn(),
  getTTSCacheGeneration: () => 0,
  setCachedTTSAudio: jest.fn(),
  getCachedTTSAudio: jest.fn(),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { id: 'speech-test' } }),
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('~/data-provider', () => ({
  useVoicesQuery: () => ({ data: ['default', 'F1'] }),
  useTextToSpeechMutation: (options: typeof mockMutationOptions) => {
    mockMutationOptions = options;
    return { mutate: mockMutate, isLoading: false };
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecoilRoot
    initializeState={({ set }) => {
      set(store.voice, 'F1');
      set(store.cacheTTS, false);
    }}
  >
    {children}
  </RecoilRoot>
);

describe('speech provider fallback', () => {
  const speak = jest.fn();
  const cancel = jest.fn();
  const setIsSpeaking = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechSnapshot.supported = true;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel, getVoices: () => [] },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        text: string;
        voice = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
  });

  it('allows the browser default when a provider voice has no browser equivalent', () => {
    const { result } = renderHook(() => useTextToSpeechBrowser({ setIsSpeaking }), { wrapper });
    act(() => expect(result.current.generateSpeechLocal('Selamat pagi', true)).toBe(true));
    expect(speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Selamat pagi', voice: null }),
    );
  });

  it('does not pretend browser speech is available when unsupported', () => {
    mockSpeechSnapshot.supported = false;
    const { result } = renderHook(() => useTextToSpeechBrowser({ setIsSpeaking }), { wrapper });
    act(() => expect(result.current.generateSpeechLocal('Selamat pagi', true)).toBe(false));
    expect(speak).not.toHaveBeenCalled();
  });

  it('reads the original text with browser speech after a provider error, and can cancel it', () => {
    const audioRef = { current: null };
    const { result } = renderHook(
      () => useTextToSpeechExternal({ setIsSpeaking, audioRef, isLast: false }),
      { wrapper },
    );
    act(() => result.current.generateSpeechExternal('Pesanan sudah siap', false));
    const form = mockMutate.mock.calls[0][0] as FormData;
    act(() => mockMutationOptions.onError(new Error('503'), form));
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Pesanan sudah siap' }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'warning' }));
    act(() => result.current.cancelSpeech());
    expect(cancel).toHaveBeenCalled();
  });

  it('reports failed downloads instead of pretending browser speech produced a file', () => {
    const audioRef = { current: null };
    const { result } = renderHook(
      () => useTextToSpeechExternal({ setIsSpeaking, audioRef, isLast: false }),
      { wrapper },
    );
    act(() => result.current.generateSpeechExternal('Pesanan sudah siap', true));
    const form = mockMutate.mock.calls[0][0] as FormData;
    act(() => mockMutationOptions.onError(new Error('503'), form));
    expect(speak).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('does not start fallback speech after a request was cancelled', () => {
    const audioRef = { current: null };
    const { result } = renderHook(
      () => useTextToSpeechExternal({ setIsSpeaking, audioRef, isLast: false }),
      { wrapper },
    );
    act(() => result.current.generateSpeechExternal('Cancelled speech', false));
    const form = mockMutate.mock.calls[0][0] as FormData;
    act(() => result.current.cancelSpeech());
    act(() => mockMutationOptions.onError(new Error('503'), form));
    expect(speak).not.toHaveBeenCalled();
  });

  it('does not speak after the message component unmounts', () => {
    const audioRef = { current: null };
    const { result, unmount } = renderHook(
      () => useTextToSpeechExternal({ setIsSpeaking, audioRef, isLast: false }),
      { wrapper },
    );
    act(() => result.current.generateSpeechExternal('Unmounted speech', false));
    const form = mockMutate.mock.calls[0][0] as FormData;
    const onError = mockMutationOptions.onError;
    unmount();
    act(() => onError(new Error('503'), form));
    expect(speak).not.toHaveBeenCalled();
  });
});
