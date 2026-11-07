import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

type AudioOwner = 'participant' | 'question' | 'playback';
interface AudioSession {
  owner: AudioOwner | null;
  claim: (kind: AudioOwner) => string | null;
  release: (token: string | null) => void;
  onStop: (listener: () => Promise<unknown>) => () => void;
  stopAll: () => Promise<void>;
}
const Context = createContext<AudioSession | null>(null);

/** Synchronous local fencing complements the server's cross-tab capture/playback leases. */
export function MeetingAudioSession({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<AudioOwner | null>(null);
  const current = useRef<{ kind: AudioOwner; token: string } | null>(null);
  const listeners = useRef(new Set<() => Promise<unknown>>());
  const claim = useCallback((kind: AudioOwner) => {
    if (current.current) return null;
    const token = crypto.randomUUID();
    current.current = { kind, token };
    setOwner(kind);
    return token;
  }, []);
  const release = useCallback((token: string | null) => {
    if (!token || current.current?.token !== token) return;
    current.current = null;
    setOwner(null);
  }, []);
  const onStop = useCallback((listener: () => Promise<unknown>) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const stopAll = useCallback(async () => {
    await Promise.all([...listeners.current].map((listener) => listener()));
  }, []);
  useEffect(
    () => () => {
      // Route consumers may leave; the shell provider alone defines real audio teardown.
      void stopAll();
    },
    [stopAll],
  );
  const value = useMemo(
    () => ({ owner, claim, release, onStop, stopAll }),
    [owner, claim, release, onStop, stopAll],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMeetingAudioSession() {
  const value = useContext(Context);
  if (!value) throw new Error('MEETING_AUDIO_SESSION_REQUIRED');
  return value;
}
