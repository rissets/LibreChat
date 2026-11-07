import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, useMediaQuery } from '@librechat/client';
import { ArrowUpRight, MessageSquare, Search, Users, Mic } from 'lucide-react';
import type { TMeetingSession } from 'librechat-data-provider';
import type { MeetingMicrophone } from './capture';
import {
  useMeetingWorkspace,
  useOpenMeetingChat,
  useMeetingChat,
  useSendMeetingChat,
  meetingChatPath,
} from '~/data-provider/Meetings/workspace';
import { useMeetingTranscript } from '~/data-provider/Meetings';
import FinalizationPanel from './FinalizationPanel';
import CaptureControls from './CaptureControls';
import { useMeetingNotes } from './NotesState';
import { formatMeetingTime } from './time';
import { SpeechPanel } from './SpeechPanel';
import { VoicePanel } from './VoicePanel';
import { useLocalize } from '~/hooks';
import Transcript from './Transcript';
import Sources from './Sources';
import Notes from './Notes';

const tabLabels = [
  'com_meeting_workspace_live_qa',
  'com_meeting_workspace_summary',
  'com_meeting_workspace_transcript',
  'com_ui_chat',
] as const;

export default function Workspace({
  session,
  userId,
  microphone,
}: {
  session: TMeetingSession;
  userId?: string;
  microphone: MeetingMicrophone;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const workspace = useMeetingWorkspace(userId, session.id);
  const transcript = useMeetingTranscript(userId, session.id);
  const notes = useMeetingNotes(session.id);
  const open = useOpenMeetingChat(userId, session.id);
  const [chatId, setChatId] = useState<string>();
  const activeChatId = chatId ?? workspace.data?.chat?.id ?? '';
  const chatHistory = useMeetingChat(userId, session.id, activeChatId);
  const send = useSendMeetingChat(userId, session.id, activeChatId);
  const [tab, setTab] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailView, setDetailView] = useState<'recording' | 'transcript' | 'results'>('recording');
  const [mobileView, setMobileView] = useState('notes');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [question, setQuestion] = useState('');
  const operation = useRef<{ id: string; question: string }>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const synthesis = workspace.data?.synthesis;
  const speakerIds = [
    ...new Set(
      transcript.data?.segments.flatMap((value) => (value.speaker ? [value.speaker] : [])) ?? [],
    ),
  ];
  const speaker = (id: string | null) => {
    if (!id) return localize('com_meeting_speaker_detecting');
    const name = workspace.data?.speakers.names[id];
    if (name) return name;
    const number = /^speaker_(\d+)$/i.exec(id)?.[1];
    return number ? localize('com_meeting_speaker_label', { 0: number }) : id;
  };
  const goToChat = async (ask = false) => {
    if (!notes || opening) return;
    setOpening(true);
    setError(false);
    try {
      if (!(await notes.flush())) {
        setError(true);
        return;
      }
      const chat = await open.mutateAsync({ id: session.id });
      setChatId(chat.id);
      if (ask) {
        const text = question.trim();
        if (!text) return;
        if (operation.current?.question !== text)
          operation.current = { id: crypto.randomUUID(), question: text };
        await send.mutateAsync({
          id: session.id,
          chatId: chat.id,
          operation_id: operation.current.id,
          question: operation.current.question,
        });
        operation.current = undefined;
        setQuestion('');
        return;
      }
      navigate(meetingChatPath(session.id, chat.id));
    } catch {
      setError(true);
    } finally {
      setOpening(false);
    }
  };
  const saveNames = async () => {
    if (!workspace.data || !notes) return;
    const names = { ...workspace.data.speakers.names, ...speakerNames };
    if (
      await notes.configure({
        speaker_names: names,
        expected_speaker_revision: workspace.data.speakers.revision,
      })
    )
      setSpeakerNames({});
    else setError(true);
  };
  return (
    <div
      className="flex min-w-0 shrink-0 flex-col gap-4 lg:min-h-0 lg:flex-1"
      aria-label={localize('com_meeting_workspace_title')}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{session.title}</h2>
          <p className="text-text-secondary mt-1 text-xs">
            {new Date(session.created_at).toLocaleDateString()} ·{' '}
            {localize('com_meeting_workspace_private')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            aria-controls="meeting-details-panel"
          >
            {localize(detailsOpen ? 'com_meeting_details_back' : 'com_meeting_workspace_details')}
          </Button>
          <Button size="sm" onClick={() => void goToChat()} disabled={opening || !notes}>
            <MessageSquare className="mr-2 size-4" aria-hidden="true" />
            {localize(opening ? 'com_ui_loading' : 'com_meeting_workspace_open_chat')}
            <ArrowUpRight className="ml-2 size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div hidden={detailsOpen} className={detailsOpen ? '' : 'flex min-h-0 flex-1 flex-col gap-4'}>
        <CaptureControls meetingId={session.id} userId={userId} microphone={microphone} />
        <label className="flex items-center gap-3 text-sm lg:hidden">
          {localize('com_meeting_workspace_view')}
          <select
            aria-label={localize('com_meeting_workspace_view')}
            value={mobileView}
            onChange={(event) => setMobileView(event.target.value)}
            className="border-border-light bg-surface-primary min-h-9 flex-1 rounded-lg border px-2"
          >
            <option value="notes">{localize('com_meeting_workspace_notes')}</option>
            <option value="panel">{localize('com_meeting_workspace_meeting_panel')}</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm">
            {localize('com_meeting_workspace_action_failed')}
          </p>
        )}
        <div className="border-border-light grid min-w-0 shrink-0 grid-cols-1 overflow-hidden rounded-xl border lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div
            hidden={!desktop && mobileView !== 'notes'}
            className={
              'min-h-0 min-w-0 flex-col' + (desktop || mobileView === 'notes' ? ' flex' : '')
            }
          >
            <Notes meetingId={session.id} userId={userId} />
          </div>
          <section
            hidden={!desktop && mobileView !== 'panel'}
            className={
              'border-border-light min-h-0 min-w-0 flex-col lg:border-l' +
              (desktop || mobileView === 'panel' ? ' flex' : '')
            }
          >
            <div
              role="tablist"
              aria-label={localize('com_meeting_workspace_panels')}
              className="border-border-light flex gap-1 border-b px-3 py-3"
            >
              {tabLabels.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  id={'meeting-tab-' + index}
                  aria-controls={'meeting-panel-' + index}
                  aria-selected={tab === index}
                  tabIndex={tab === index ? 0 : -1}
                  className={
                    'min-h-9 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none ' +
                    (tab === index
                      ? 'bg-surface-secondary text-text-primary font-medium'
                      : 'text-text-secondary hover:bg-surface-hover')
                  }
                  onClick={() => setTab(index)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    let next =
                      (index + (event.key === 'ArrowRight' ? 1 : tabLabels.length - 1)) %
                      tabLabels.length;
                    if (event.key === 'Home') next = 0;
                    if (event.key === 'End') next = tabLabels.length - 1;
                    setTab(next);
                    document.getElementById('meeting-tab-' + next)?.focus();
                  }}
                >
                  {localize(label)}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={'meeting-panel-' + tab}
              aria-labelledby={'meeting-tab-' + tab}
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto p-5"
            >
              {tab === 0 && (
                <>
                  {workspace.data && !workspace.data.capabilities.diarization.ready && (
                    <p role="status" className="text-text-secondary mb-4 text-xs">
                      {localize('com_meeting_workspace_qa_waiting_speakers')}
                    </p>
                  )}
                  {synthesis?.content?.discussion_qa.length ? (
                    <ul className="space-y-6">
                      {synthesis.content.discussion_qa.map((item, index) => (
                        <li key={index}>
                          <p className="text-text-secondary mb-1 text-xs font-medium">
                            {speaker(item.question_speaker)}
                          </p>
                          <h3 className="text-sm leading-6 font-medium">{item.question}</h3>
                          <div className="bg-surface-secondary mt-3 rounded-lg p-3">
                            <p className="text-text-secondary mb-1 text-xs">
                              {item.answer
                                ? speaker(item.answer_speaker)
                                : localize('com_meeting_workspace_unanswered')}
                            </p>
                            {item.answer && <p className="text-sm leading-6">{item.answer}</p>}
                          </div>
                          <Sources
                            userId={userId}
                            meetingId={session.id}
                            operationId={synthesis.operation_id ?? undefined}
                            citations={item.citations}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-text-secondary flex min-h-60 flex-col items-center justify-center gap-3 text-center text-sm">
                      <MessageSquare className="size-7" strokeWidth={1.5} aria-hidden="true" />
                      <p>{localize('com_meeting_workspace_qa_empty')}</p>
                    </div>
                  )}
                </>
              )}
              {tab === 1 && (
                <>
                  <p className="text-text-secondary mb-4 text-xs">
                    {localize('com_meeting_workspace_provisional')}
                  </p>
                  {synthesis?.content ? (
                    <div className="space-y-6">
                      {(
                        [
                          ['com_meeting_workspace_highlights', synthesis.content.summary],
                          ['com_meeting_workspace_decisions', synthesis.content.decisions],
                          ['com_meeting_workspace_actions', synthesis.content.actions],
                          ['com_meeting_workspace_open_questions', synthesis.content.unresolved],
                        ] as const
                      ).map(([label, facts]) =>
                        facts.length ? (
                          <section key={label}>
                            <h3 className="mb-3 text-sm font-semibold">{localize(label)}</h3>
                            <ul className="space-y-3">
                              {facts.map((fact, index) => (
                                <li key={index} className="text-sm leading-6">
                                  <p>{fact.text}</p>
                                  <Sources
                                    userId={userId}
                                    meetingId={session.id}
                                    operationId={synthesis.operation_id ?? undefined}
                                    citations={fact.citations}
                                  />
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <p role="status" className="text-text-secondary text-sm">
                      {localize('com_meeting_workspace_summary_empty')}
                    </p>
                  )}
                </>
              )}
              {tab === 2 && (
                <>
                  {transcript.data?.acknowledgements.some((item) =>
                    ['accepted', 'processing'].includes(item.state),
                  ) && (
                    <p role="status" className="text-text-secondary mb-3 text-xs">
                      {localize('com_meeting_workspace_transcribing')}
                    </p>
                  )}
                  <label className="border-border-light mb-5 flex items-center gap-2 rounded-lg border px-3">
                    <Search className="text-text-secondary size-4" aria-hidden="true" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={localize('com_meeting_workspace_search_transcript')}
                      aria-label={localize('com_meeting_workspace_search_transcript')}
                    />
                  </label>
                  <ol className="space-y-5">
                    {transcript.data?.segments
                      .filter(
                        (item) =>
                          !search ||
                          item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                      )
                      .map((segment) => (
                        <li key={segment.id}>
                          <div className="text-text-secondary mb-1.5 flex items-center gap-2 text-xs">
                            <span className="font-medium">{speaker(segment.speaker)}</span>
                            <span className="tabular-nums">
                              {formatMeetingTime(segment.start_ms)}
                            </span>
                            {segment.state === 'provisional' && (
                              <span>{localize('com_meeting_workspace_provisional')}</span>
                            )}
                          </div>
                          <p className="text-sm leading-7">{segment.text}</p>
                        </li>
                      ))}
                  </ol>
                  {!transcript.data?.segments.length && (
                    <p role="status" className="text-text-secondary text-sm">
                      {localize('com_meeting_transcript_empty')}
                    </p>
                  )}
                  {!!transcript.data?.gaps.length && (
                    <p className="text-text-secondary mt-5 text-xs">
                      {localize('com_meeting_workspace_capture_gaps')}
                    </p>
                  )}
                  <details className="border-border-light mt-6 border-t pt-4">
                    <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                      <Users className="size-4" aria-hidden="true" />
                      {localize('com_meeting_speaker_auto')}
                    </summary>
                    {!workspace.data?.capabilities.diarization.ready && (
                      <p role="status" className="text-text-secondary mt-3 text-xs">
                        {localize('com_meeting_workspace_diarization_unavailable')}
                      </p>
                    )}
                    {speakerIds.map((id) => (
                      <label key={id} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <span className="min-w-20">{speaker(id)}</span>
                        <Input
                          aria-label={localize('com_meeting_workspace_speaker_name') + ' ' + id}
                          value={speakerNames[id] ?? workspace.data?.speakers.names[id] ?? ''}
                          maxLength={100}
                          onChange={(event) =>
                            setSpeakerNames((names) => ({ ...names, [id]: event.target.value }))
                          }
                          className="flex-1"
                        />
                      </label>
                    ))}
                    {!!speakerIds.length && (
                      <Button
                        size="sm"
                        className="mt-3"
                        disabled={!Object.keys(speakerNames).length}
                        onClick={() => void saveNames()}
                      >
                        {localize('com_meeting_workspace_save_names')}
                      </Button>
                    )}
                  </details>
                </>
              )}
              {tab === 3 && (
                <>
                  {chatHistory.data?.operations.length ? (
                    <ol className="space-y-6">
                      {chatHistory.data.operations.map((turn) => (
                        <li key={turn.id} className="space-y-2">
                          <p className="text-sm leading-6 font-medium">
                            {turn.question || localize('com_meeting_voice')}
                          </p>
                          {turn.content?.answer && (
                            <p className="bg-surface-secondary rounded-lg p-3 text-sm leading-6 whitespace-pre-wrap">
                              {turn.content.answer}
                            </p>
                          )}
                          <Sources
                            userId={userId}
                            meetingId={session.id}
                            operationId={turn.id}
                            citations={turn.content?.citations ?? []}
                          />
                          {turn.input_kind === 'voice' &&
                            turn.state === 'completed' &&
                            turn.content?.answer && (
                              <SpeechPanel
                                meetingId={session.id}
                                answerId={turn.id}
                                answerText={turn.content.answer}
                                captureActive={microphone.state === 'capturing'}
                                userId={userId}
                                hideSharing
                              />
                            )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="text-text-secondary flex min-h-60 flex-col items-center justify-center gap-3 text-center text-sm">
                      <MessageSquare className="size-7" strokeWidth={1.5} aria-hidden="true" />
                      <p>{localize('com_meeting_assistant_empty')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            {tab === 3 && (
              <form
                className="border-border-light border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void goToChat(true);
                }}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="meeting-question"
                    value={question}
                    disabled={opening}
                    onChange={(event) => {
                      operation.current = undefined;
                      setQuestion(event.target.value);
                    }}
                    maxLength={2000}
                    aria-label={localize('com_meeting_question')}
                    placeholder={localize('com_meeting_workspace_ask_placeholder')}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!question.trim() || opening || !notes}
                    aria-label={localize('com_meeting_question_send')}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </div>
                <details className="mt-2">
                  <summary className="text-text-secondary flex min-h-8 cursor-pointer items-center gap-2 text-xs">
                    <Mic className="size-3.5" aria-hidden="true" />
                    {localize('com_meeting_workspace_ask_voice')}
                  </summary>
                  <VoicePanel
                    meetingId={session.id}
                    userId={userId}
                    microphone={microphone}
                    compact
                  />
                </details>
              </form>
            )}
          </section>
        </div>
      </div>
      {detailsOpen && (
        <section
          id="meeting-details-panel"
          aria-label={localize('com_meeting_workspace_details')}
          className="border-border-light flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
        >
          <div
            className="border-border-light flex flex-wrap items-center gap-2 border-b p-3"
            aria-label={localize('com_meeting_workspace_details')}
          >
            {(
              [
                ['recording', 'com_meeting_details_recording'],
                ['transcript', 'com_meeting_live_transcript'],
                ['results', 'com_meeting_final_title'],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={detailView === id ? 'default' : 'outline'}
                aria-pressed={detailView === id}
                onClick={() => setDetailView(id)}
              >
                {localize(label)}
              </Button>
            ))}
          </div>
          <div className="max-h-[65vh] min-h-0 flex-1 overflow-y-auto p-4 md:p-5 lg:max-h-none">
            {detailView === 'results' ? (
              <FinalizationPanel session={session} userId={userId} />
            ) : (
              <Transcript
                session={session}
                userId={userId}
                microphone={microphone}
                view={detailView}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
