import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { TMeetingWorkspaceInput } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useMeetingWorkspace, useSaveMeetingWorkspace } from '~/data-provider/Meetings/workspace';
import { subscribeMeetingAccessLoss } from '~/data-provider/Meetings/access';
import { useMeetingRuntime } from './runtime-context';

type Settings = Pick<
  TMeetingWorkspaceInput,
  'speaker_names' | 'expected_speaker_revision' | 'live_synthesis_enabled' | 'retry_live_enhance'
>;
interface NotesState {
  meetingId: string;
  text: string;
  dirty: boolean;
  saving: boolean;
  failed: boolean;
  conflict: boolean;
  setText: (text: string) => void;
  flush: () => Promise<boolean>;
  configure: (settings: Settings) => Promise<boolean>;
  resolve: (useServer: boolean) => void;
}
const Context = createContext<NotesState | null>(null);

/** Autosave lives with the application runtime, so changing routes cannot cancel it. */
function NotesSession({
  userId,
  meetingId,
  children,
}: {
  userId?: string;
  meetingId: string;
  children: ReactNode;
}) {
  const workspace = useMeetingWorkspace(userId, meetingId);
  const { beforeSwitch } = useMeetingRuntime();
  const save = useSaveMeetingWorkspace(userId, meetingId);
  const { mutateAsync: saveNotes } = save;
  const { refetch } = workspace;
  const [text, updateText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = useRef({ text: '', saved: '', revision: -1, denied: false, conflict: false });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const remote = useRef(workspace.data);
  remote.current = workspace.data;
  useEffect(() => {
    const notes = workspace.data?.notes;
    if (!notes || current.current.denied) return;
    if (current.current.revision === -1 || current.current.text === current.current.saved) {
      current.current = {
        ...current.current,
        text: notes.text,
        saved: notes.text,
        revision: notes.revision,
      };
      updateText(notes.text);
      setDirty(false);
    } else if (notes.revision !== current.current.revision && !inFlight.current) {
      if (current.current.text === notes.text) {
        current.current.revision = notes.revision;
        current.current.saved = notes.text;
        setDirty(false);
      } else {
        current.current.conflict = true;
        setConflict(true);
      }
    }
  }, [workspace.data?.notes]);
  useEffect(
    () =>
      subscribeMeetingAccessLoss({ userId, meetingId }, (reason, change) => {
        if (reason === 'transport' || reason === 'hidden') return;
        if (
          reason === 'lifecycle' &&
          change?.value.classes.transcript?.available !== false &&
          !change?.removals.some((row) => ['meeting', 'transcript'].includes(row.artifact_class))
        )
          return;
        current.current = { text: '', saved: '', revision: -1, denied: true, conflict: false };
        updateText('');
        setDirty(false);
      }),
    [userId, meetingId],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      if (!(await inFlight.current)) return false;
    }
    const draft = current.current;
    if (draft.denied || draft.revision < 0 || draft.conflict) return false;
    if (draft.text === draft.saved) return true;
    const submitted = draft.text;
    setSaving(true);
    const request = saveNotes({
      id: meetingId,
      expected_revision: draft.revision,
      notes: submitted,
    })
      .then((value) => {
        if (current.current.denied) return false;
        current.current.saved = submitted;
        current.current.revision = value.notes.revision;
        setDirty(current.current.text !== submitted);
        setFailed(false);
        return true;
      })
      .catch((error) => {
        if (!current.current.denied) setFailed(true);
        void refetch().then((res) => {
          const fresh = res.data?.notes;
          if (fresh && fresh.revision > current.current.revision) {
            current.current.revision = fresh.revision;
            current.current.saved = fresh.text;
            if (current.current.text !== fresh.text) {
              setDirty(true);
            }
            setFailed(false);
          }
        });
        return false;
      })
      .finally(() => {
        inFlight.current = null;
        setSaving(false);
      });
    inFlight.current = request;
    return request;
  }, [meetingId, saveNotes, refetch]);

  useEffect(() => {
    if (!dirty || saving || failed || conflict) return;
    const timer = window.setTimeout(() => void flush(), 700);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, failed, conflict, text, flush]);

  const setText = (value: string) => {
    if (current.current.denied) return;
    current.current.text = value;
    updateText(value);
    setDirty(value !== current.current.saved);
    setFailed(false);
  };
  const flushAll = useCallback(async () => {
    if (inFlight.current && !(await inFlight.current)) return false;
    while (current.current.text !== current.current.saved) if (!(await flush())) return false;
    return !current.current.denied && current.current.revision >= 0 && !current.current.conflict;
  }, [flush]);
  useLayoutEffect(
    () =>
      beforeSwitch(() => {
        if (!inFlight.current && current.current.text === current.current.saved) return true;
        return flushAll();
      }),
    [beforeSwitch, flushAll],
  );
  const configure = async (settings: Settings) => {
    if (!(await flushAll())) return false;
    try {
      const value = await saveNotes({
        id: meetingId,
        expected_revision: current.current.revision,
        notes: current.current.saved,
        ...settings,
      });
      current.current.revision = value.notes.revision;
      return true;
    } catch {
      setFailed(true);
      void refetch();
      return false;
    }
  };
  const resolve = (useServer: boolean) => {
    const notes = remote.current?.notes;
    if (!notes) return;
    current.current.revision = notes.revision;
    current.current.saved = notes.text;
    current.current.conflict = false;
    setConflict(false);
    setFailed(false);
    if (useServer) setText(notes.text);
    else setDirty(current.current.text !== notes.text);
  };
  return (
    <Context.Provider
      value={{
        meetingId,
        text,
        dirty,
        saving,
        failed,
        conflict,
        setText,
        flush: flushAll,
        configure,
        resolve,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function MeetingNotesProvider({ children }: { children: ReactNode }) {
  const runtime = useMeetingRuntime();
  if (!runtime.session) return <>{children}</>;
  return (
    <NotesSession
      key={runtime.userId + ':' + runtime.session.id}
      userId={runtime.userId}
      meetingId={runtime.session.id}
    >
      {children}
    </NotesSession>
  );
}
export function useMeetingNotes(meetingId: string) {
  const value = useContext(Context);
  return value?.meetingId === meetingId ? value : null;
}
