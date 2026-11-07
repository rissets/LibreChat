/* eslint-disable i18next/no-literal-string -- Test harness navigation labels. */
import React, { useEffect, useRef, useState } from 'react';
import { ToastContext } from '@librechat/client';
import { dataService, meetingWorkspaceSchema, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TMeetingSession, TMeetingTranscript } from 'librechat-data-provider';
import { MeetingRecordingStrip, MeetingRuntimeProvider, useMeetingRuntime } from '../Runtime';
import { invalidateMeetingAccess } from '~/data-provider/Meetings/access';
import { MeetingNotesProvider } from '../NotesState';
import { useMeetingAudioSession } from '../audio';
import CaptureControls from '../CaptureControls';
import MeetingWorkspace from '../Workspace';
import MeetingVoice from '../Question';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../pcm.js?url', () => 'pcm-worklet.js', { virtual: true });
// Browser storage and media APIs are uncontrollable in jsdom. The production capture hook,
// query/access boundaries, audio fencing and route consumers are used without substitution.
jest.mock('../buffer', () => ({
  bufferEpoch: () => 0,
  readBuffer: async () => ({ frames: [], interruption: null }),
  saveBuffer: async () => undefined,
  discardBuffer: async () => undefined,
}));

const first: TMeetingSession = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'Planning meeting',
  created_at: '',
  revision: 1,
  capture_state: 'not_started',
  finalization_state: 'not_requested',
  visibility: 'private',
  artifact_classes: [],
};
const second: TMeetingSession = {
  ...first,
  id: '10000000-0000-4000-8000-000000000002',
  title: 'Another meeting',
};
const capture = {
  id: '20000000-0000-4000-8000-000000000001',
  capture_token: '30000000-0000-4000-8000-000000000001',
  state: 'capturing' as const,
  next_sequence: 7,
  elapsed_ms: 0,
  policy_revision: '1',
};
const transcript: TMeetingTranscript = {
  capture: null,
  context_revision: '1',
  recovery_retention_seconds: 300,
  playbacks: [],
  gaps: [],
  acknowledgements: [],
  segments: [],
  limits: {
    duration_limit_seconds: 3600,
    duration_source: 'applied_policy',
    technical_max_seconds: 3600,
    observed_seconds: 0,
    slot_held: false,
    slot_expires_at: null,
    error_code: null,
    policies: [],
  },
};
const track: { stop: jest.Mock; onended: null | (() => void) } = { stop: jest.fn(), onended: null };
const mockShowToast = jest.fn();
function workspaceValue(id: string) {
  return {
    meeting_id: id,
    notes: { text: '', revision: 0, updated_at: null },
    speakers: { revision: 0, names: {} },
    capabilities: { diarization: { ready: false }, live_synthesis: { ready: true } },
    synthesis: {
      state: 'idle',
      enabled: false,
      context_revision: null,
      notes_revision: 0,
      operation_id: null,
      content: null,
      error_code: null,
    },
    live_enhance: {
      enabled: true,
      state: 'idle',
      notes_revision: 0,
      content: null,
      error_code: null,
    },
    chat: null,
  };
}
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const processors: FakeProcessor[] = [];
const disconnect = jest.fn();
const close = jest.fn();
class FakeProcessor {
  port = {
    onmessage: null as ((event: { data: object }) => void) | null,
    close: jest.fn(),
    postMessage: () => this.port.onmessage?.({ data: { type: 'flushed' } }),
  };

  constructor() {
    processors.push(this);
  }

  connect() {}
  disconnect = disconnect;
}
class FakeContext {
  sampleRate = 16000;
  destination = {};
  audioWorklet = { addModule: async () => undefined };
  createMediaStreamSource() {
    return { connect() {}, disconnect };
  }

  async resume() {}
  close = close;
}
function Workspace({ full = false }: { full?: boolean }) {
  const { id } = useParams();
  const runtime = useMeetingRuntime();
  const [denied, setDenied] = useState(false);
  const session = id === second.id ? second : first;
  const { attach } = runtime;
  useEffect(() => {
    setDenied(!attach(session));
  }, [attach, session]);
  if (denied) return <p>Another recording is active</p>;
  if (runtime.session?.id !== session.id || !runtime.microphone) return null;
  if (full)
    return (
      <MeetingWorkspace session={session} userId={runtime.userId} microphone={runtime.microphone} />
    );
  return (
    <>
      <h1>{session.title}</h1>
      <p>{runtime.microphone.state}</p>
      <CaptureControls
        meetingId={session.id}
        userId={runtime.userId}
        microphone={runtime.microphone}
      />
    </>
  );
}
const stopPlayback = jest.fn();
function AssistantAudio() {
  const { claim, release, owner, onStop } = useMeetingAudioSession();
  const token = useRef<string | null>(null);
  useEffect(
    () =>
      onStop(async () => {
        if (!token.current) return;
        stopPlayback();
        release(token.current);
        token.current = null;
      }),
    [onStop, release],
  );
  return (
    <>
      <button
        onClick={() => {
          token.current = claim('playback');
        }}
      >
        Play assistant
      </button>
      <p>{owner ?? 'no audio'}</p>
    </>
  );
}
function App({ userId = 'owner', full = false }: { userId?: string; full?: boolean }) {
  return (
    <MemoryRouter initialEntries={['/meetings/' + first.id]}>
      <ToastContext.Provider value={{ showToast: mockShowToast }}>
        <MeetingRuntimeProvider userId={userId}>
          <MeetingNotesProvider>
            {userId && (
              <>
                <MeetingRecordingStrip />
                <AssistantAudio />
              </>
            )}
            <Link to={'/c/meeting-' + first.id + '-40000000-0000-4000-8000-000000000001'}>
              Open chat
            </Link>
            <Link to={'/meetings/' + first.id}>Workspace</Link>
            <Link to={'/meetings/' + second.id}>Other meeting</Link>
            <Routes>
              <Route path="/c/new" element={<h1>Ordinary chat</h1>} />
              <Route path="/meetings/:id" element={userId ? <Workspace full={full} /> : null} />
              <Route
                path="/c/:chatId"
                element={
                  <>
                    <h1>Meeting chat</h1>
                    <MeetingVoice
                      conversationId={
                        'meeting-' + first.id + '-40000000-0000-4000-8000-000000000001'
                      }
                    />
                  </>
                }
              />
            </Routes>
          </MeetingNotesProvider>
        </MeetingRuntimeProvider>
      </ToastContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue(stream),
      enumerateDevices: async () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: FakeProcessor });
  jest
    .spyOn(dataService, 'getMeetingAccess')
    .mockResolvedValue({ allowed: true, policy_revisions: [] });
  jest.spyOn(dataService, 'getMeetingTranscript').mockResolvedValue(transcript);
  const workspaces = new Map<string, ReturnType<typeof workspaceValue>>();
  jest.spyOn(dataService, 'getMeetingWorkspace').mockImplementation(async (id) => {
    if (!workspaces.has(id)) workspaces.set(id, workspaceValue(id));
    return workspaces.get(id)!;
  });
  jest
    .spyOn(dataService, 'saveMeetingWorkspace')
    .mockImplementation(async ({ id, notes, expected_revision }) => {
      const value = {
        ...workspaceValue(id),
        notes: { text: notes, revision: expected_revision + 1, updated_at: null },
      };
      workspaces.set(id, value);
      return value;
    });
  jest.spyOn(dataService, 'getMeetingFinalization').mockResolvedValue({
    state: 'not_requested',
    durable: false,
    can_retry: false,
    result: null,
    versions: [],
  });
  jest.spyOn(dataService, 'getMeetingVoice').mockResolvedValue({ questions: [] });
  jest.spyOn(dataService, 'openMeetingChat').mockResolvedValue({
    id: '40000000-0000-4000-8000-000000000001',
    meeting_id: first.id,
    title: 'Meeting chat',
    created_at: '',
    updated_at: '',
  });
  jest.spyOn(dataService, 'getMeetingChat').mockResolvedValue({
    chat: {
      id: '40000000-0000-4000-8000-000000000001',
      meeting_id: first.id,
      title: 'Meeting chat',
      created_at: '',
      updated_at: '',
    },
    operations: [],
  });
  jest.spyOn(dataService, 'sendMeetingChat').mockRejectedValue(new Error('Response lost'));
  jest.spyOn(dataService, 'beginMeetingVoice').mockRejectedValue(new Error('Provider unavailable'));
  jest
    .spyOn(dataService, 'cancelMeetingVoice')
    .mockRejectedValue(new Error('Cancelled unavailable attempt'));
  let operationSequence = 0;
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: jest.fn(
      () => '50000000-0000-4000-8000-' + String(++operationSequence).padStart(12, '0'),
    ),
  });
  jest.spyOn(dataService, 'getMeetingLifecycle').mockResolvedValue({
    classes: { meeting: { available: true }, transcript: { available: true } },
    meeting_id: first.id,
    policy: {
      seconds: { processing_audio: 300 },
      configured: true,
      clocks: {},
      policy_revisions: [],
    },
    generation: 1,
    removals: [],
  });
  jest.spyOn(dataService, 'changeMeetingCapture').mockImplementation(async (body) => {
    if (body.action === 'pause') return { ...capture, state: 'paused' };
    if (body.action === 'stop') return { ...capture, state: 'stopped' };
    return { ...capture, state: 'capturing' };
  });
  jest.spyOn(dataService, 'submitMeetingAudio').mockImplementation(async (body) => ({
    id: 'ack',
    chunk_id: body.chunk_id,
    capture_id: body.capture_id,
    sequence: body.sequence,
    durable: true,
    state: 'accepted',
    start_ms: 0,
    duration_ms: 1000,
    attempt_id: 'attempt',
    receipt_id: null,
    error_code: null,
  }));
});
afterEach(() => jest.useRealTimers());

async function mount(userId: string | undefined = 'owner', full = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={cache}>
        <App userId={userId} full={full} />
      </QueryClientProvider>,
    );
  });
  return { ...result, cache };
}
async function start() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'com_meeting_start_capture' })).toBeEnabled(),
  );
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_start_capture' }));
  await screen.findByText('capturing');
}
async function frame() {
  act(() =>
    processors[processors.length - 1].port.onmessage?.({
      data: { type: 'frame', samples: new Float32Array(160).buffer },
    }),
  );
  await waitFor(() => expect(dataService.submitMeetingAudio).toHaveBeenCalled());
}

test('keeps capture lease, sequence and heartbeat across chat navigation and reattachment', async () => {
  const view = await mount();
  await start();
  expect(screen.getByRole('region', { name: 'com_meeting_runtime_active' })).toBeVisible();
  await frame();
  expect(dataService.submitMeetingAudio).toHaveBeenLastCalledWith(
    expect.objectContaining({ sequence: 7, capture_id: capture.id }),
    expect.anything(),
  );
  fireEvent.click(screen.getByText('Open chat'));
  await screen.findByRole('heading', { name: 'Meeting chat' });
  expect(track.stop).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'com_meeting_runtime_active' })).toBeVisible();
  await frame();
  await waitFor(() => expect(dataService.submitMeetingAudio).toHaveBeenCalledTimes(2));
  expect(dataService.submitMeetingAudio).toHaveBeenLastCalledWith(
    expect.objectContaining({ sequence: 8, capture_token: capture.capture_token }),
    expect.anything(),
  );
  fireEvent.click(screen.getByText('Workspace'));
  await screen.findByText('capturing');
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  expect(
    jest
      .mocked(dataService.changeMeetingCapture)
      .mock.calls.filter(([body]) => body.action === 'start'),
  ).toHaveLength(1);
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(dataService.changeMeetingCapture).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'heartbeat', capture_token: capture.capture_token }),
    expect.anything(),
  );
  view.unmount();
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

test('shows the recording strip in the workspace while active and paused', async () => {
  await mount();
  await start();
  expect(screen.getByRole('region', { name: 'com_meeting_runtime_active' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_pause_capture' }));
  await screen.findByText('com_meeting_runtime_paused');
  expect(screen.getByRole('region', { name: 'com_meeting_runtime_active' })).toBeVisible();
  const strip = screen.getByRole('region', { name: 'com_meeting_runtime_active' });
  fireEvent.click(within(strip).getByRole('button', { name: 'com_meeting_stop_capture' }));
  await waitFor(() => expect(strip).not.toBeInTheDocument());
});

test('refuses a second recording and supports pause, resume and stop from chat', async () => {
  await mount();
  await start();
  fireEvent.click(screen.getByText('Other meeting'));
  await screen.findByText('Another recording is active');
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Open chat'));
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_recording_controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_pause_capture' }));
  await screen.findByRole('button', { name: 'com_meeting_resume_capture' });
  expect(track.stop).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_resume_capture' }));
  await screen.findByRole('button', { name: 'com_meeting_pause_capture' });
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_stop_capture' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'com_meeting_runtime_active' }),
    ).not.toBeInTheDocument(),
  );
  expect(track.stop).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(dataService.changeMeetingCapture).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', capture_token: capture.capture_token }),
      expect.anything(),
    ),
  );
});

test('erases private runtime and releases microphone on access loss while on chat', async () => {
  await mount();
  await start();
  fireEvent.click(screen.getByText('Open chat'));
  act(() => invalidateMeetingAccess('owner', first.id));
  await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByRole('region', { name: 'com_meeting_runtime_active' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Planning meeting')).not.toBeInTheDocument();
});

test('leaves the meeting chat shell when organization access becomes unavailable', async () => {
  const view = await mount();
  await start();
  fireEvent.click(screen.getByText('Open chat'));
  await screen.findByRole('heading', { name: 'Meeting chat' });
  act(() => {
    view.cache.setQueryData([QueryKeys.meetingAccess, 'owner'], { allowed: false, revisions: [] });
    invalidateMeetingAccess('owner');
  });
  await screen.findByRole('heading', { name: 'Ordinary chat' });
  expect(screen.queryByRole('heading', { name: 'Meeting chat' })).not.toBeInTheDocument();
  await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
});

test('releases capture on logout rather than keeping it on the next account', async () => {
  const view = await mount();
  await start();
  view.rerender(
    <QueryClientProvider client={view.cache}>
      <App userId="" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
  expect(close).toHaveBeenCalledTimes(1);
});

test('keeps participant and assistant audio fenced while the route changes', async () => {
  await mount();
  await start();
  fireEvent.click(screen.getByText('Open chat'));
  fireEvent.click(screen.getByRole('button', { name: 'Play assistant' }));
  expect(screen.getByText('participant')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_recording_controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_pause_capture' }));
  await screen.findByRole('button', { name: 'com_meeting_resume_capture' });
  fireEvent.click(screen.getByRole('button', { name: 'Play assistant' }));
  await screen.findByText('playback');
  expect(screen.getByRole('button', { name: 'com_meeting_resume_capture' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_stop_capture' }));
  await waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

test('does not reattach the removed authorized view after access loss on the workspace', async () => {
  await mount();
  await start();
  act(() => invalidateMeetingAccess('owner', first.id));
  await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByRole('region', { name: 'com_meeting_runtime_active' }),
  ).not.toBeInTheDocument();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
});

async function editNotes(value = 'Keep this draft') {
  const editor = await screen.findByRole('textbox', { name: 'com_meeting_workspace_notes' });
  await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'));
  fireEvent.focus(editor);
  fireEvent.keyDown(editor, {
    key: 'a',
    code: 'KeyA',
    ctrlKey: !navigator.platform.includes('Mac'),
    metaKey: navigator.platform.includes('Mac'),
  });
  const selection = window.getSelection();
  selection?.selectAllChildren(editor);
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? value : ''),
      types: ['text/plain'],
      files: [],
    },
  });
  return editor;
}

test('workspace schema retains live enhancement independently of synthesis', () => {
  const value = workspaceValue(first.id);
  const parsed = meetingWorkspaceSchema.parse({
    ...value,
    live_enhance: { ...value.live_enhance, state: 'queued', notes_revision: 2 },
  });
  expect(parsed.live_enhance).toEqual({
    enabled: true,
    state: 'queued',
    notes_revision: 2,
    content: null,
    error_code: null,
  });
  expect(parsed.synthesis).toEqual(value.synthesis);
});

test('does not show enhanced notes from an older notes revision', async () => {
  const value = {
    ...workspaceValue(first.id),
    notes: { text: 'Catatan baru', revision: 2, updated_at: null },
    live_enhance: {
      ...workspaceValue(first.id).live_enhance,
      enabled: true,
      state: 'completed',
      notes_revision: 1,
      content: {
        answer: '',
        citations: [],
        summary: [],
        decisions: [],
        unresolved: [],
        actions: [],
        unknowns: [],
        enhanced_notes: [{ text: 'Catatan lama', citations: [] }],
        discussion_qa: [],
      },
    },
  };
  jest.mocked(dataService.getMeetingWorkspace).mockResolvedValue(value);
  await mount('owner', true);
  await screen.findByText('Catatan baru');
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(screen.queryByText('Catatan lama')).not.toBeInTheDocument();
});

test('shows current live enhancement, hides it on edit, and never toggles synthesis', async () => {
  const value = {
    ...workspaceValue(first.id),
    notes: { text: 'Original notes', revision: 2, updated_at: null },
    live_enhance: {
      ...workspaceValue(first.id).live_enhance,
      state: 'completed',
      notes_revision: 2,
      content: {
        answer: '',
        citations: [],
        summary: [],
        decisions: [],
        unresolved: [],
        actions: [],
        unknowns: [],
        enhanced_notes: [{ text: 'Enhanced notes', citations: [] }],
        discussion_qa: [],
      },
    },
  };
  jest.mocked(dataService.getMeetingWorkspace).mockResolvedValue(value);
  await mount('owner', true);
  await screen.findByText('Original notes');
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(screen.getByText('Enhanced notes')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_write' }));
  await editNotes('Changed notes');
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(screen.queryByText('Enhanced notes')).not.toBeInTheDocument();
  expect(dataService.saveMeetingWorkspace).not.toHaveBeenCalled();
});

test('retries a failed enhancement without toggling synthesis', async () => {
  const value = {
    ...workspaceValue(first.id),
    live_enhance: {
      ...workspaceValue(first.id).live_enhance,
      state: 'failed',
      error_code: 'FAILED',
    },
  };
  jest.mocked(dataService.getMeetingWorkspace).mockResolvedValue(value);
  await mount('owner', true);
  await screen.findByRole('button', { name: 'com_meeting_workspace_enhanced' });
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(await screen.findByText('com_meeting_workspace_enhance_failed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_retry' }));
  await waitFor(() =>
    expect(dataService.saveMeetingWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ retry_live_enhance: true }),
      expect.anything(),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'com_meeting_editor_refresh' }),
  ).not.toBeInTheDocument();
});

test('saves newly edited notes before quick selection of another idle meeting', async () => {
  await mount('owner', true);
  await editNotes();
  fireEvent.click(screen.getByText('Other meeting'));
  await screen.findByRole('heading', { name: second.title });
  expect(dataService.saveMeetingWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ id: first.id, notes: 'Keep this draft', expected_revision: 0 }),
    expect.anything(),
  );
  fireEvent.click(screen.getByText('Workspace'));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'com_meeting_workspace_notes' })).toHaveTextContent(
      'Keep this draft',
    ),
  );
});

test('retains failed notes and offers return to save instead of selecting another meeting', async () => {
  jest.mocked(dataService.saveMeetingWorkspace).mockRejectedValue(new Error('Offline'));
  await mount('owner', true);
  await editNotes();
  await act(async () => {
    jest.advanceTimersByTime(700);
  });
  await screen.findByText('com_meeting_workspace_save_failed');
  fireEvent.click(screen.getByText('Other meeting'));
  await screen.findByRole('link', { name: 'com_meeting_review_return_to_save' });
  expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'com_meeting_review_return_to_save' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'com_meeting_workspace_notes' })).toHaveTextContent(
      'Keep this draft',
    ),
  );
});

test('waits for an existing save and all newer edits before changing selected meeting', async () => {
  let finish!: (value: ReturnType<typeof workspaceValue>) => void;
  jest.mocked(dataService.saveMeetingWorkspace).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount('owner', true);
  await editNotes('First draft');
  await act(async () => {
    jest.advanceTimersByTime(700);
  });
  await editNotes('Newest draft');
  fireEvent.click(screen.getByText('Other meeting'));
  expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument();
  await act(async () =>
    finish({
      ...workspaceValue(first.id),
      notes: { text: 'First draft', revision: 1, updated_at: null },
    }),
  );
  await screen.findByRole('heading', { name: second.title });
  expect(dataService.saveMeetingWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: first.id, notes: 'Newest draft', expected_revision: 1 }),
    expect.anything(),
  );
});

test('voice waits for pending notes before freezing the question context', async () => {
  let finish!: (value: ReturnType<typeof workspaceValue>) => void;
  jest.mocked(dataService.saveMeetingWorkspace).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount('owner', true);
  await editNotes('Voice context draft');
  fireEvent.change(screen.getByRole('combobox', { name: 'com_meeting_workspace_view' }), {
    target: { value: 'panel' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'com_ui_chat' }));
  fireEvent.click(screen.getByText('com_meeting_workspace_ask_voice'));
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_voice_start' }));
  await waitFor(() => expect(dataService.saveMeetingWorkspace).toHaveBeenCalled());
  expect(dataService.beginMeetingVoice).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      ...workspaceValue(first.id),
      notes: { text: 'Voice context draft', revision: 1, updated_at: null },
    }),
  );
  await waitFor(() => expect(dataService.beginMeetingVoice).toHaveBeenCalledTimes(1));
});

test('failed notes prevent voice dispatch and show a visible save failure', async () => {
  jest.mocked(dataService.saveMeetingWorkspace).mockRejectedValue(new Error('Offline'));
  await mount('owner', true);
  await editNotes();
  fireEvent.change(screen.getByRole('combobox', { name: 'com_meeting_workspace_view' }), {
    target: { value: 'panel' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'com_ui_chat' }));
  fireEvent.click(screen.getByText('com_meeting_workspace_ask_voice'));
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_voice_start' }));
  await screen.findByText('com_meeting_review_voice_save_failed');
  expect(dataService.beginMeetingVoice).not.toHaveBeenCalled();
  expect(dataService.sendMeetingChat).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('answers workspace questions in the Chat tab with speech for voice turns and opens the same chat', async () => {
  const operations: Array<{
    id: string;
    purpose: 'answer';
    input_kind: 'text' | 'voice';
    question: string;
    context_revision: string;
    context_segment_count: number;
    context_end_ms: number;
    attempt_id: string;
    state: 'completed';
    receipt_id: null;
    receipt_state: null;
    error_code: null;
    policy_revision: string;
    created_at: string;
    provenance: Record<string, never>;
    content: {
      answer: string;
      citations: never[];
      summary: never[];
      decisions: never[];
      unresolved: never[];
      actions: never[];
      unknowns: never[];
      enhanced_notes: never[];
      discussion_qa: never[];
    };
  }> = [
    {
      id: '50000000-0000-4000-8000-000000000099',
      purpose: 'answer',
      input_kind: 'voice',
      question: 'Voice question',
      context_revision: '1',
      context_segment_count: 1,
      context_end_ms: 1000,
      attempt_id: 'attempt',
      state: 'completed',
      receipt_id: null,
      receipt_state: null,
      error_code: null,
      policy_revision: '1',
      created_at: '',
      provenance: {},
      content: {
        answer: 'Voice answer',
        citations: [],
        summary: [],
        decisions: [],
        unresolved: [],
        actions: [],
        unknowns: [],
        enhanced_notes: [],
        discussion_qa: [],
      },
    },
  ];
  jest.spyOn(dataService, 'getMeetingSpeech').mockResolvedValue({ speech: null });
  jest.mocked(dataService.getMeetingChat).mockImplementation(async () => ({
    chat: {
      id: '40000000-0000-4000-8000-000000000001',
      meeting_id: first.id,
      title: 'Meeting chat',
      created_at: '',
      updated_at: '',
    },
    operations,
  }));
  jest.mocked(dataService.sendMeetingChat).mockImplementation(async (body) => {
    const turn = {
      ...operations[0],
      id: body.operation_id,
      input_kind: 'text' as const,
      question: body.question,
      content: { ...operations[0].content, answer: 'Schedule confirmed for Tuesday.' },
    };
    operations.push(turn);
    return turn;
  });
  await mount('owner', true);
  await editNotes();
  fireEvent.change(screen.getByRole('combobox', { name: 'com_meeting_workspace_view' }), {
    target: { value: 'panel' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'com_ui_chat' }));
  const question = screen.getByRole('textbox', { name: 'com_meeting_question' });
  fireEvent.change(question, { target: { value: 'What was decided?' } });
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_question_send' }));
  await waitFor(() =>
    expect(dataService.sendMeetingChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id, question: 'What was decided?' }),
      expect.anything(),
    ),
  );
  expect(await screen.findByText('Schedule confirmed for Tuesday.')).toBeVisible();
  expect(screen.getByRole('region', { name: 'com_meeting_speech' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'com_meeting_question' })).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_open_chat' }));
  await screen.findByRole('heading', { name: 'Meeting chat' });
});

test('does not show a recording shortcut before explicit capture starts', async () => {
  await mount();
  expect(
    screen.queryByRole('region', { name: 'com_meeting_runtime_active' }),
  ).not.toBeInTheDocument();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('switches between notes and meeting panel without discarding the notes draft', async () => {
  await mount('owner', true);
  const editor = await editNotes('Preserve the narrow-screen draft');
  const selector = screen.getByRole('combobox', { name: 'com_meeting_workspace_view' });
  fireEvent.change(selector, { target: { value: 'panel' } });
  expect(
    screen.queryByRole('textbox', { name: 'com_meeting_workspace_notes' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'com_meeting_question' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'com_ui_chat' }));
  expect(screen.getByRole('textbox', { name: 'com_meeting_question' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'com_meeting_workspace_summary' }));
  expect(screen.queryByRole('textbox', { name: 'com_meeting_question' })).not.toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'notes' } });
  expect(editor).toBeVisible();
  expect(editor).toHaveTextContent('Preserve the narrow-screen draft');
  expect(screen.queryByRole('textbox', { name: 'com_meeting_question' })).not.toBeInTheDocument();
});

test('notifies capture failure on chat while removing the active shortcut', async () => {
  await mount();
  await start();
  fireEvent.click(screen.getByText('Open chat'));
  act(() => track.onended?.());
  await waitFor(() =>
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_meeting_mic_device', status: 'error' }),
    ),
  );
  expect(
    screen.queryByRole('region', { name: 'com_meeting_runtime_active' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Workspace'));
  expect(screen.getByRole('alert')).toHaveTextContent('com_meeting_mic_device');
});

test('opens governed voice from the native microphone control without an inline voice panel', async () => {
  await mount();
  fireEvent.click(screen.getByText('Open chat'));
  expect(screen.queryByRole('region', { name: 'com_meeting_voice' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'com_ui_use_micrphone' }));
  expect(await screen.findByRole('region', { name: 'com_meeting_voice' })).toBeVisible();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('keeps the microphone alive when an earlier provider chunk is uncertain', async () => {
  const { cache } = await mount();
  await start();
  const value: TMeetingTranscript = {
    ...transcript,
    capture,
    acknowledgements: [
      {
        id: 'failed-audio',
        chunk_id: 'chunk',
        capture_id: capture.id,
        sequence: 6,
        durable: true,
        state: 'uncertain',
        start_ms: 0,
        duration_ms: 2000,
        attempt_id: 'attempt',
        receipt_id: null,
        error_code: 'MEDIA_PROVIDER_UNAVAILABLE',
      },
    ],
  };
  jest.mocked(dataService.getMeetingTranscript).mockResolvedValue(value);
  await act(async () => {
    cache.setQueryData([QueryKeys.meetingTranscript, 'owner', first.id], value);
  });
  expect(track.stop).not.toHaveBeenCalled();
  await screen.findByText('capturing');
  await frame();
  expect(dataService.submitMeetingAudio).toHaveBeenCalledWith(
    expect.objectContaining({ sequence: 7 }),
    expect.anything(),
  );
  expect(dataService.changeMeetingCapture).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: 'interrupt' }),
    expect.anything(),
  );
});

test('consumes a durable uncertain upload acknowledgement and records subsequent frames', async () => {
  const submit = jest.mocked(dataService.submitMeetingAudio).getMockImplementation();
  if (!submit) throw new Error('Missing media fixture');
  jest.mocked(dataService.submitMeetingAudio).mockImplementationOnce(async (...args) => ({
    ...(await submit(...args)),
    state: 'uncertain',
    error_code: 'MEDIA_PROVIDER_UNAVAILABLE',
  }));
  await mount();
  await start();
  await frame();
  expect(track.stop).not.toHaveBeenCalled();
  await frame();
  await waitFor(() => expect(dataService.submitMeetingAudio).toHaveBeenCalledTimes(2));
  expect(dataService.submitMeetingAudio).toHaveBeenLastCalledWith(
    expect.objectContaining({ sequence: 8 }),
    expect.anything(),
  );
});

test('older workspace responses parse and show enhancement unavailable', async () => {
  const { live_enhance: _removed, ...older } = workspaceValue(first.id);
  expect(meetingWorkspaceSchema.parse(older).live_enhance).toBeUndefined();
  jest.mocked(dataService.getMeetingWorkspace).mockResolvedValue(older);
  await mount('owner', true);
  fireEvent.click(await screen.findByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(screen.getAllByText('com_meeting_workspace_enhance_unavailable').length).toBeGreaterThan(
    0,
  );
  expect(screen.queryByText('com_meeting_workspace_enhancing')).not.toBeInTheDocument();
});

test('synthesis control is removed from the notes workspace', async () => {
  await mount('owner', true);
  expect(
    screen.queryByRole('checkbox', {
      name: 'com_meeting_workspace_synthesis_control',
    }),
  ).not.toBeInTheDocument();
});

test('workspace load errors remain retryable in enhanced mode', async () => {
  jest.mocked(dataService.getMeetingWorkspace).mockRejectedValue(new Error('offline'));
  await mount('owner', true);
  fireEvent.click(await screen.findByRole('button', { name: 'com_meeting_workspace_enhanced' }));
  expect(await screen.findByRole('button', { name: 'com_meeting_retry' })).toBeInTheDocument();
});

test('defaults to side-by-side notes view on wide screens', async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)' || query === '(min-width: 1024px)',
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  try {
    const value = {
      ...workspaceValue(first.id),
      notes: { text: 'Catatan asli', revision: 1, updated_at: null },
      live_enhance: {
        ...workspaceValue(first.id).live_enhance,
        state: 'completed',
        notes_revision: 1,
        content: {
          answer: '',
          citations: [],
          summary: [],
          decisions: [],
          unresolved: [],
          actions: [],
          unknowns: [],
          enhanced_notes: [{ text: 'Catatan hasil enhance', citations: [] }],
          discussion_qa: [],
        },
      },
    };
    jest.mocked(dataService.getMeetingWorkspace).mockResolvedValue(value);
    await mount('owner', true);
    expect(await screen.findByText('Catatan asli')).toBeInTheDocument();
    expect(await screen.findByText('Catatan hasil enhance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_meeting_workspace_split' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});
