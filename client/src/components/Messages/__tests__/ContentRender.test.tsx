import React from 'react';
import { RecoilRoot } from 'recoil';
import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import type { Agent, TConversation, TMessage } from 'librechat-data-provider';
import type { TMessageChatContext } from '~/common';
import { MeetingAudioSession } from '~/components/Meetings/audio';
import ContentRender from '../ContentRender';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'owner' } }) }));

const mockRenders = { parts: 0 };

/**
 * Memoized like the real parts tree with its default comparator, and rendering the
 * resume header it is handed where a steer would place it.
 */
jest.mock('~/components/Chat/Messages/Content/ContentParts', () => {
  const { memo } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: memo(function MockContentParts({ authorHeader }: { authorHeader?: React.ReactNode }) {
      mockRenders.parts += 1;
      return <div data-testid="parts">{authorHeader}</div>;
    }),
  };
});

jest.mock('~/components/Chat/Messages/MessageIcon', () => ({
  __esModule: true,
  default: ({ agent }: { agent?: { name?: string } }) => (
    <span data-testid="message-icon" data-agent={agent?.name ?? ''} />
  ),
}));

jest.mock('~/components/Chat/Messages/HoverButtons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Chat/Messages/ui/MessageTimestamp', () => ({
  __esModule: true,
  default: () => null,
}));

/**
 * Stands in for the agents map: `useMessageActions` reads it through context, so the
 * agents list landing re-renders the memoized row without any new props.
 */
const mockAgentContext = React.createContext<Agent | undefined>(undefined);
const mockActions = {
  enterEdit: jest.fn(),
  handleContinue: jest.fn(),
  handleFeedback: jest.fn(),
  copyToClipboard: jest.fn(),
  getCanCopy: jest.fn(() => true),
  regenerateMessage: jest.fn(),
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAttachments: () => ({ attachments: undefined, searchResults: undefined }),
  useContentMetadata: () => ({ hasParallelContent: false }),
  useMessageActions: ({
    message,
    chatContext,
  }: {
    message?: TMessage;
    chatContext: TMessageChatContext;
  }) => {
    const { useContext } = jest.requireActual<typeof import('react')>('react');
    const agent = useContext(mockAgentContext);
    return {
      ...mockActions,
      edit: false,
      index: chatContext.index,
      agent,
      assistant: undefined,
      conversation: chatContext.conversation,
      messageLabel: agent?.name ?? message?.sender,
      latestMessageId: chatContext.latestMessageId,
      latestMessageDepth: chatContext.latestMessageDepth,
      hasConfiguredSender: false,
    };
  },
}));

const conversation = {
  conversationId: 'convo-1',
  endpoint: 'agents',
  agent_id: 'agent_lia',
} as TConversation;

const chatContext: TMessageChatContext = {
  ask: jest.fn(),
  index: 0,
  regenerate: jest.fn(),
  conversation,
  latestMessageId: 'user-1',
  latestMessageDepth: 1,
  handleContinue: jest.fn(),
  feedbackEnabled: false,
  isSubmitting: false,
};

const assistantMessage = {
  messageId: 'assistant-1',
  parentMessageId: 'user-1',
  conversationId: conversation.conversationId,
  sender: 'agent_lia',
  isCreatedByUser: false,
  text: '',
  content: [{ type: 'text', text: 'Done.' }],
  createdAt: '2026-09-17T00:00:00.000Z',
} as TMessage;

const lia = { id: 'agent_lia', name: 'Lia' } as Agent;
const setSiblingIdx = jest.fn();
const setCurrentEditId = jest.fn();

/** Renders one row with no agent resolved yet, and lets the test land the agents list. */
const renderRow = (message: TMessage) => {
  const view = (agent?: Agent) => (
    <RecoilRoot>
      <mockAgentContext.Provider value={agent}>
        <ContentRender
          message={message}
          chatContext={chatContext}
          siblingIdx={0}
          siblingCount={1}
          setSiblingIdx={setSiblingIdx}
          currentEditId={null}
          setCurrentEditId={setCurrentEditId}
        />
      </mockAgentContext.Provider>
    </RecoilRoot>
  );
  const result = render(view());
  return { ...result, resolveAgent: (agent: Agent) => result.rerender(view(agent)) };
};

describe('ContentRender resume author header', () => {
  beforeEach(() => {
    mockRenders.parts = 0;
  });

  it('keeps the parts tree from re-rendering when the agent resolves after paint', () => {
    const { resolveAgent } = renderRow(assistantMessage);
    const partsRendersAtPaint = mockRenders.parts;

    resolveAgent(lia);

    // The row itself did re-render: its own header now names the agent.
    expect(screen.getAllByTestId('message-icon')[0]).toHaveAttribute('data-agent', 'Lia');
    expect(mockRenders.parts).toBe(partsRendersAtPaint);
  });

  it('still restates the resolved author inside the message', () => {
    const { resolveAgent } = renderRow(assistantMessage);
    const parts = screen.getByTestId('parts');
    expect(within(parts).getByRole('heading', { level: 2 })).toHaveTextContent('agent_lia');

    resolveAgent(lia);

    expect(within(parts).getByRole('heading', { level: 2 })).toHaveTextContent('Lia');
    expect(within(parts).getByTestId('message-icon')).toHaveAttribute('data-agent', 'Lia');
  });

  it('hands a user message no resume header', () => {
    renderRow({ ...assistantMessage, messageId: 'user-2', isCreatedByUser: true });

    expect(screen.getByTestId('parts')).toBeEmptyDOMElement();
  });
});

it('renders CP context, authenticated sources and speech on the native agents message path and updates metadata-only revisions', async () => {
  const meetingId = '10000000-0000-4000-8000-000000000091';
  const chatId = '20000000-0000-4000-8000-000000000091';
  const operationId = '30000000-0000-4000-8000-000000000091';
  const segmentId = '40000000-0000-4000-8000-000000000091';
  const evidence = jest.spyOn(dataService, 'getMeetingEvidence').mockResolvedValue({
    context_revision: '2',
    segment: {
      id: segmentId,
      revision: 3,
      text: 'Approved private note',
      start_ms: 0,
      end_ms: 1000,
      speaker: null,
      state: 'note',
    },
  });
  const speech = jest.spyOn(dataService, 'getMeetingSpeech').mockResolvedValue({ speech: null });
  jest.spyOn(dataService, 'getMeetingTranscript').mockImplementation(() => new Promise(() => {}));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const message = {
    ...assistantMessage,
    endpoint: 'agents',
    conversationId: `meeting-${meetingId}-${chatId}`,
    metadata: {
      meeting: {
        meeting_id: meetingId,
        chat_id: chatId,
        operation_id: operationId,
        state: 'completed',
        context_end_ms: 1000,
        citations: [{ segment_id: segmentId, revision: 3 }],
      },
    },
  };
  const view = (value: TMessage) => (
    <QueryClientProvider client={cache}>
      <RecoilRoot>
        <MeetingAudioSession>
          <ContentRender
            message={value}
            chatContext={chatContext}
            siblingIdx={0}
            siblingCount={1}
            setSiblingIdx={setSiblingIdx}
            currentEditId={null}
            setCurrentEditId={setCurrentEditId}
          />
        </MeetingAudioSession>
      </RecoilRoot>
    </QueryClientProvider>
  );
  const rendered = render(view(message));
  expect(screen.getByText(/com_meeting_workspace_context_until/)).toHaveTextContent('00:01');
  fireEvent.click(screen.getByRole('button', { name: 'com_meeting_workspace_source 1' }));
  expect(await screen.findByText('Approved private note')).toBeInTheDocument();
  expect(evidence).toHaveBeenCalledWith(
    meetingId,
    operationId,
    segmentId,
    3,
    expect.any(AbortSignal),
  );
  const details = screen.getByText('com_meeting_workspace_listen').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() =>
    expect(speech).toHaveBeenCalledWith(meetingId, operationId, expect.any(AbortSignal)),
  );
  rendered.rerender(
    view({
      ...message,
      metadata: { meeting: { ...message.metadata.meeting, context_end_ms: 9000 } },
    }),
  );
  expect(screen.getByText(/com_meeting_workspace_context_until/)).toHaveTextContent('00:09');
  rendered.unmount();
  cache.clear();
});
