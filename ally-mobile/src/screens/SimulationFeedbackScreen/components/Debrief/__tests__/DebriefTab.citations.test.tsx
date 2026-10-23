import React from 'react';
import {render} from '@testing-library/react-native';

import {DebriefTab} from '../DebriefTab';

/**
 * Citation rendering in the debrief reply thread.
 *
 * The backend already resolves the `[m:ss]` timestamps Ally writes into real
 * transcript rows (`processCitations` in scenario-session-chat.service.ts).
 * Both apps used to discard that payload and render the bare bracket text, so
 * these lock in that the learner can now see — and reach — what was cited.
 */

const mockUseAskAIChat = jest.fn();

jest.mock('../../AskAI/useAskAIChat', () => ({
  useAskAIChat: (...args: unknown[]) => mockUseAskAIChat(...args),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('../SupervisorNote', () => {
  const {View} = require('react-native');
  return {SupervisorNote: () => <View testID="supervisor-note" />};
});

jest.mock('../DebriefReplyInput', () => {
  const {View} = require('react-native');
  return {DebriefReplyInput: () => <View testID="reply-input" />};
});

jest.mock('react-native-linear-gradient', () => {
  const {View} = require('react-native');
  return {__esModule: true, default: View};
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

const CITATION = {
  timestamp: '4:12',
  content: 'What are evenings like for you?',
  senderId: 7,
  transcriptId: 91,
};

const details = {
  details: {summary: {feedback: {supervisorNote: 'Good work.'}}},
  scenario: {metadata: {name: 'Meera'}},
} as never;

const chatWith = (messages: unknown[]) => ({
  messages,
  isStreaming: false,
  isLoading: false,
  error: undefined,
  sendMessage: jest.fn(),
  retry: jest.fn(),
});

describe('DebriefTab — reply citations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the cited transcript lines under an assistant reply', () => {
    mockUseAskAIChat.mockReturnValue(
      chatWith([
        {
          id: 'm1',
          role: 'assistant',
          content: 'At [4:12] you moved on quickly.',
          citations: [CITATION],
        },
      ]),
    );

    const {getByText} = render(
      <DebriefTab
        scenarioSessionId="s-1"
        simulationDetails={details}
        retryLimitReached={false}
        onOpenMoment={jest.fn()}
      />,
    );

    expect(getByText('askAi.transcriptReferences')).toBeTruthy();
    // RN nests the quoted line beside its speaker label inside one <Text>, so
    // match on substring rather than the whole node.
    expect(getByText(/What are evenings like for you\?/)).toBeTruthy();
    expect(getByText(/transcription\.youLabel/)).toBeTruthy();
  });

  it('renders inline **bold** as emphasis rather than literal asterisks', () => {
    mockUseAskAIChat.mockReturnValue(
      chatWith([
        {
          id: 'm1',
          role: 'assistant',
          content: 'You used a **closed question** there.',
          citations: [],
        },
      ]),
    );

    const {getByText, queryByText} = render(
      <DebriefTab
        scenarioSessionId="s-1"
        simulationDetails={details}
        retryLimitReached={false}
      />,
    );

    expect(getByText('closed question')).toBeTruthy();
    expect(queryByText(/\*\*/)).toBeNull();
  });

  it('renders no references block when the reply cites nothing', () => {
    mockUseAskAIChat.mockReturnValue(
      chatWith([
        {id: 'm1', role: 'assistant', content: 'Good session.', citations: []},
      ]),
    );

    const {queryByText} = render(
      <DebriefTab
        scenarioSessionId="s-1"
        simulationDetails={details}
        retryLimitReached={false}
      />,
    );

    expect(queryByText('askAi.transcriptReferences')).toBeNull();
  });

  it('holds back citations while the reply is still streaming', () => {
    // A half-written answer's timestamps have not been resolved yet; showing a
    // references block that grows mid-sentence reads as a glitch.
    mockUseAskAIChat.mockReturnValue(
      chatWith([
        {
          id: 'm1',
          role: 'assistant',
          content: 'At [4:12]',
          citations: [CITATION],
          isStreaming: true,
        },
      ]),
    );

    const {queryByText} = render(
      <DebriefTab
        scenarioSessionId="s-1"
        simulationDetails={details}
        retryLimitReached={false}
      />,
    );

    expect(queryByText('askAi.transcriptReferences')).toBeNull();
  });

  it('never loads the thread in read-only (from Logs) mode', () => {
    mockUseAskAIChat.mockReturnValue(chatWith([]));

    render(
      <DebriefTab
        scenarioSessionId="s-1"
        simulationDetails={details}
        retryLimitReached={false}
        readOnly
      />,
    );

    // An empty session id is useAskAIChat's own no-op path.
    expect(mockUseAskAIChat).toHaveBeenCalledWith({scenarioSessionId: ''});
  });
});
