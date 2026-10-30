import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {DebriefTab} from '../DebriefTab';

/**
 * The Debrief agent's debrief swaps in for today's note only when the
 * learner's organisation is switched on; everything else keeps today's view.
 */

const mockQuery = jest.fn();
const mockHelpful = jest.fn();
const mockFlag = jest.fn();
const mockUndo = jest.fn();

jest.mock('@/services/learnerDebriefApi', () => ({
  LEARNER_DEBRIEF_POLL_MS: 5000,
  useGetLearnerDebriefQuery: (...args: unknown[]) => mockQuery(...args),
  useSetDebriefHelpfulMutation: () => [mockHelpful, {isLoading: false}],
  useFlagDebriefCardMutation: () => [mockFlag, {isLoading: false}],
  useUndoDebriefFlagMutation: () => [mockUndo, {isLoading: false}],
}));

jest.mock('../../AskAI/useAskAIChat', () => ({
  useAskAIChat: () => ({
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: undefined,
    sendMessage: jest.fn(),
    retry: jest.fn(),
  }),
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

const details = {
  details: {summary: {feedback: {supervisorNote: 'Today’s note.'}}},
  scenario: {metadata: {name: 'Meera'}},
} as never;

const CARDS = {
  opening: 'You stayed calm when Meena went quiet.',
  important_moment: {
    turn_index: 7,
    quote: 'I don’t see the point any more.',
    handled_well: true,
    lead: 'You noticed this and asked directly.',
    body: 'Asking plainly helps the person feel heard.',
    others: [{turn_index: 9, quote: 'Nobody would notice.', note: 'You moved on.'}],
  },
  what_worked: [
    {skill: 'Reflections', turn_index: 3, quote: 'It sounds lonely.', lead: 'You named her feeling.', body: 'It showed you heard.'},
  ],
  work_on_this: [
    {skill: 'Open questions', turn_index: 5, quote: 'Did you tell her?', lead: 'This closed the conversation.', why: 'A yes/no question is an easy way out.', try_saying: 'What happened when you told her?'},
  ],
  practise_next: {skill: 'Open questions', reason: 'It came up twice.'},
  skill_words: [{skill: 'Reflections', word: 'strength'}],
  reflective_question: 'What made it hard to ask?',
  progress_note: null,
};

const renderTab = (readOnly = false) =>
  render(
    <DebriefTab
      scenarioSessionId="s-1"
      simulationDetails={details}
      retryLimitReached={false}
      readOnly={readOnly}
    />,
  );

const ready = (extra: Record<string, unknown> = {}) =>
  mockQuery.mockReturnValue({
    data: {state: 'ready', runId: 'r1', cards: CARDS, language: 'en', ...extra},
  });

describe('DebriefTab — the Debrief agent’s debrief', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    [mockHelpful, mockFlag, mockUndo].forEach(m =>
      m.mockReturnValue({unwrap: () => Promise.resolve({})}),
    );
  });

  it('keeps today’s note when the organisation is not switched on', () => {
    mockQuery.mockReturnValue({data: {state: 'not_available'}});
    const {getByTestId, queryByTestId} = renderTab();
    expect(getByTestId('supervisor-note')).toBeTruthy();
    expect(queryByTestId('debrief-cards')).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith('s-1', {skip: false, pollingInterval: 0});
  });

  it('keeps today’s note while loading or after a failed request', () => {
    mockQuery.mockReturnValue({data: undefined, isError: true});
    expect(renderTab().getByTestId('supervisor-note')).toBeTruthy();
  });

  it('asks on the read-only Logs view too, and keeps today’s note when refused', () => {
    mockQuery.mockReturnValue({data: undefined, isError: true});
    const {getByTestId} = renderTab(true);
    expect(mockQuery).toHaveBeenCalledWith('s-1', {
      skip: false,
      pollingInterval: 0,
    });
    expect(getByTestId('supervisor-note')).toBeTruthy();
  });

  it('shows the cards in order, with every other risk moment and a try-saying line', () => {
    ready();
    const {getByTestId, queryByTestId, getByText} = renderTab();
    expect(queryByTestId('supervisor-note')).toBeNull();
    expect(getByTestId('debrief-card-important-moment')).toBeTruthy();
    expect(getByTestId('debrief-other-moments')).toBeTruthy();
    expect(getByText('“Nobody would notice.”')).toBeTruthy();
    expect(getByTestId('debrief-try-saying')).toBeTruthy();
    expect(getByTestId('debrief-helpful')).toBeTruthy();
  });

  it('shows the working panel and polls while the agent writes', () => {
    mockQuery.mockReturnValue({data: {state: 'working', steps: ['Reading your session…', 'Writing your debrief…']}});
    const {getByTestId, getByText} = renderTab();
    expect(getByTestId('debrief-working')).toBeTruthy();
    expect(getByText('Writing your debrief…')).toBeTruthy();
    expect(mockQuery).toHaveBeenLastCalledWith('s-1', {skip: false, pollingInterval: 5000});
  });

  it('sends a flag with a reason, only once a reason is picked', async () => {
    ready();
    const {getAllByText, getByText} = renderTab();
    // Flags appear on the important moment, each strength and growth point, and practise next.
    fireEvent.press(getAllByText('postSim.debriefCards.flag.open')[2]);
    fireEvent.press(getByText('postSim.debriefCards.flag.send'));
    expect(mockFlag).not.toHaveBeenCalled();
    fireEvent.press(getByText('postSim.debriefCards.flag.reasons.advice_doesnt_fit'));
    await act(async () => {
      fireEvent.press(getByText('postSim.debriefCards.flag.send'));
    });
    await waitFor(() =>
      expect(mockFlag).toHaveBeenCalledWith({
        sessionId: 's-1',
        section: 'work_on_this[0]',
        reason: 'advice_doesnt_fit',
        note: undefined,
      }),
    );
  });

  it('hides a removed card, shows a kept card’s reason, and records helpful', () => {
    ready({
      corrections: [
        {section: 'work_on_this[0]', outcome: 'removed', note: null, at: ''},
        {section: 'what_worked[0]', outcome: 'kept', note: 'It is in turn 3.', at: ''},
      ],
      feedback: {helpful: null, flags: []},
    });
    const {queryByTestId, getByTestId, getByText} = renderTab();
    expect(queryByTestId('debrief-card-work-on-this')).toBeNull();
    expect(getByTestId('debrief-removed-note')).toBeTruthy();
    expect(getByTestId('debrief-correction')).toBeTruthy();
    fireEvent.press(getByText('postSim.debriefCards.helpful.no'));
    expect(mockHelpful).toHaveBeenCalledWith({sessionId: 's-1', helpful: false});
  });
});
