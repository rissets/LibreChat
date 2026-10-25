import { act, renderHook } from '@testing-library/react';
import useSpeechToText from './useSpeechToText';

let mockSpeechToTextEndpoint = 'external';
let mockBrowserIsListening = false;
let mockExternalIsListening = false;
let mockProviderUnavailable = false;
const mockResetProviderError = jest.fn();

const mockStartSpeechRecordingBrowser = jest.fn();
const mockStopSpeechRecordingBrowser = jest.fn();
const mockStartSpeechRecordingExternal = jest.fn();
const mockStopSpeechRecordingExternal = jest.fn();

jest.mock('./useGetAudioSettings', () => ({
  __esModule: true,
  default: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
}));

jest.mock('./useSpeechToTextBrowser', () => ({
  __esModule: true,
  default: () => ({
    isListening: mockBrowserIsListening,
    isLoading: false,
    startRecording: mockStartSpeechRecordingBrowser,
    stopRecording: mockStopSpeechRecordingBrowser,
  }),
}));

jest.mock('./useSpeechToTextExternal', () => ({
  __esModule: true,
  default: () => ({
    isListening: mockExternalIsListening,
    providerUnavailable: mockProviderUnavailable,
    resetProviderError: mockResetProviderError,
    isLoading: false,
    externalStartRecording: mockStartSpeechRecordingExternal,
    externalStopRecording: mockStopSpeechRecordingExternal,
  }),
}));

describe('useSpeechToText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'external';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockProviderUnavailable = false;
  });

  it('selects the externally seeded engine after settings change', () => {
    mockSpeechToTextEndpoint = 'browser';
    const { result, rerender } = renderHook(() =>
      useSpeechToText(jest.fn(), jest.fn(), jest.fn(), -1),
    );

    mockSpeechToTextEndpoint = 'external';
    rerender();

    act(() => result.current.startRecording());

    expect(mockStartSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('selects the browser engine', () => {
    mockSpeechToTextEndpoint = 'browser';
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn(), jest.fn(), -1));

    act(() => result.current.startRecording());

    expect(mockStartSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('selects the active engine stop handler', () => {
    mockExternalIsListening = true;
    const { result } = renderHook(() => useSpeechToText(jest.fn(), jest.fn(), jest.fn(), -1));

    act(() => result.current.stopRecording());

    expect(mockStopSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('uses browser dictation for the next recording after the provider fails', () => {
    const { result, rerender } = renderHook(() =>
      useSpeechToText(jest.fn(), jest.fn(), jest.fn(), -1),
    );
    mockProviderUnavailable = true;
    rerender();

    act(() => result.current.startRecording());

    expect(mockStartSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
  });

  it('clears a provider failure when the user changes the selected engine', () => {
    const { rerender } = renderHook(() => useSpeechToText(jest.fn(), jest.fn(), jest.fn(), -1));
    mockResetProviderError.mockClear();
    mockSpeechToTextEndpoint = 'browser';
    rerender();
    expect(mockResetProviderError).toHaveBeenCalledTimes(1);
  });
});
