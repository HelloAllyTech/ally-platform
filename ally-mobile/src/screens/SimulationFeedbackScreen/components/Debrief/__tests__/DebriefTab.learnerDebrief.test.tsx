import React from 'react';
import {Linking} from 'react-native';
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
const mockMarkRead = jest.fn();
const mockFetchAudio = jest.fn();
const mockGetScenario = jest.fn();
const mockNavigate = jest.fn();
const mockAskAIChat = jest.fn();
const mockSend = jest.fn();

jest.mock('@/services/learnerDebriefApi', () => ({
  LEARNER_DEBRIEF_POLL_MS: 3000,
  LEARNER_DEBRIEF_SLOW_POLL_MS: 30000,
  LEARNER_DEBRIEF_FAST_FOR_MS: 240000,
  useGetLearnerDebriefQuery: (...args: unknown[]) => mockQuery(...args),
  useSetDebriefHelpfulMutation: () => [mockHelpful, {isLoading: false}],
  useFlagDebriefCardMutation: () => [mockFlag, {isLoading: false}],
  useUndoDebriefFlagMutation: () => [mockUndo, {isLoading: false}],
  useMarkDebriefReadMutation: () => [mockMarkRead],
  useLazyGetDebriefCardAudioQuery: () => [mockFetchAudio],
}));

jest.mock('@/services/simulationsApi', () => ({
  useLazyGetScenarioByIdQuery: () => [mockGetScenario, {isFetching: false}],
}));

jest.mock('../../AskAI/useAskAIChat', () => ({
  useAskAIChat: (options: unknown) => {
    mockAskAIChat(options);
    return {
      messages: [],
      isStreaming: false,
      isLoading: false,
      error: undefined,
      sendMessage: mockSend,
      retry: jest.fn(),
    };
  },
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useAppNavigation: () => ({navigate: mockNavigate}),
}));

// The hidden read-aloud player: a View that hands its callbacks to the test.
const mockPlayer: {props?: any} = {};
jest.mock('react-native-video', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      mockPlayer.props = props;
      return <View testID={props.testID} />;
    },
  };
});

jest.mock('../SupervisorNote', () => {
  const {View} = require('react-native');
  return {SupervisorNote: () => <View testID="supervisor-note" />};
});

jest.mock('../DebriefReplyInput', () => {
  const {Text, View} = require('react-native');
  return {
    DebriefReplyInput: ({
      onSend,
      placeholder,
    }: {
      onSend: (text: string) => void;
      placeholder?: string;
    }) => (
      <View testID="reply-input">
        <Text>{placeholder}</Text>
        <Text onPress={() => onSend('Why was that hard?')}>send</Text>
      </View>
    ),
  };
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

const SUPPORT = [
  {name: 'Tele-MANAS', phone: '14416', hours: 'Tele-MANAS (24×7)', isCrisis: true},
  {name: 'Your supervisor', phone: '+91 98450-12345'},
];

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
    expect(mockQuery).toHaveBeenLastCalledWith('s-1', {skip: false, pollingInterval: 3000});
  });

  it('slows to every 30 s after four minutes of working, and polls 30 s while on its way', () => {
    jest.useFakeTimers();
    try {
      mockQuery.mockReturnValue({data: {state: 'working', steps: []}});
      renderTab();
      expect(mockQuery).toHaveBeenLastCalledWith('s-1', {skip: false, pollingInterval: 3000});
      act(() => {
        jest.advanceTimersByTime(4 * 60_000);
      });
      expect(mockQuery).toHaveBeenLastCalledWith('s-1', {skip: false, pollingInterval: 30000});
    } finally {
      jest.useRealTimers();
    }
    mockQuery.mockReturnValue({data: {state: 'on_its_way'}});
    renderTab();
    expect(mockQuery).toHaveBeenLastCalledWith('s-1', {skip: false, pollingInterval: 30000});
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

  it('puts care first when the learner was in distress: cards stay collapsed until asked for', () => {
    ready({distress: true, supportLines: SUPPORT});
    const {getByTestId, queryByTestId, getByText} = renderTab();
    expect(getByTestId('debrief-distress')).toBeTruthy();
    expect(getByText('postSim.debriefCards.distress.supportLead')).toBeTruthy();
    expect(queryByTestId('debrief-card-opening')).toBeNull();
    const toggle = getByTestId('debrief-when-ready');
    expect(toggle.props.accessibilityState).toEqual({expanded: false});
    fireEvent.press(toggle);
    expect(getByTestId('debrief-card-opening')).toBeTruthy();
    expect(getByTestId('debrief-when-ready').props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  it('ends the important moment with the support lines, each a tap-to-call link', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    ready({supportLines: SUPPORT});
    const {getByTestId, getByText} = renderTab();
    expect(getByTestId('debrief-support-lines')).toBeTruthy();
    expect(getByText('Tele-MANAS (24×7)')).toBeTruthy();
    fireEvent.press(getByText('Tele-MANAS · 14416'));
    expect(openURL).toHaveBeenCalledWith('tel:14416');
    fireEvent.press(getByText('Your supervisor · +91 98450-12345'));
    expect(openURL).toHaveBeenCalledWith('tel:+919845012345');
    openURL.mockRestore();
  });

  it('offers "Practise this" only for a roleplay the learner can open, and opens its details screen', async () => {
    ready({
      cards: {
        ...CARDS,
        work_on_this: [{...CARDS.work_on_this[0], scenario_id: 42}],
        // Not in `practice`: archived, or not assigned to this learner.
        practise_next: {...CARDS.practise_next, scenario_id: 99},
      },
      practice: [{id: 42, title: 'Meena, a second call'}],
    });
    const scenario = {id: 42, title: 'Meena, a second call'};
    mockGetScenario.mockReturnValue({unwrap: () => Promise.resolve(scenario)});
    const {getByTestId, queryByTestId} = renderTab();
    expect(queryByTestId('debrief-practise-next')).toBeNull();
    const button = getByTestId('debrief-practise-this');
    expect(button.props.accessibilityLabel).toBe('postSim.debriefCards.practise.label');
    await act(async () => {
      fireEvent.press(button);
    });
    expect(mockGetScenario).toHaveBeenCalledWith({id: '42'}, true);
    expect(mockNavigate).toHaveBeenCalledWith('SimulationDetails', {scenario});
  });

  it('shows "Practise this next" when the practise-next roleplay is available', () => {
    ready({
      cards: {...CARDS, practise_next: {...CARDS.practise_next, scenario_id: 7}},
      practice: [{id: 7, title: 'Open questions'}],
    });
    const {getByTestId, queryByTestId} = renderTab();
    expect(getByTestId('debrief-practise-next')).toBeTruthy();
    expect(queryByTestId('debrief-practise-this')).toBeNull();
  });

  it('puts Ask Ally under the reflective question, posting to the Debrief agent’s stream', () => {
    ready();
    const {getByTestId, getByText} = renderTab();
    expect(mockAskAIChat).toHaveBeenLastCalledWith({
      scenarioSessionId: 's-1',
      streamPath: '/debriefs/sessions/s-1/reply/stream',
    });
    const question = getByTestId('debrief-card-reflective-question');
    expect(question).toContainElement(getByTestId('ask-ally'));
    expect(getByText('postSim.debriefCards.reply.placeholder')).toBeTruthy();
    fireEvent.press(getByText('send'));
    expect(mockSend).toHaveBeenCalledWith('Why was that hard?');
  });

  it('has no Ask Ally on the read-only Logs view, and no thread is loaded', () => {
    ready();
    const {queryByTestId, getByTestId} = renderTab(true);
    expect(getByTestId('debrief-card-reflective-question')).toBeTruthy();
    expect(queryByTestId('ask-ally')).toBeNull();
    expect(mockAskAIChat).toHaveBeenLastCalledWith({
      scenarioSessionId: '',
      streamPath: undefined,
    });
  });

  it('reads every card in order, skipping removed ones, and highlights the one being read', async () => {
    ready({
      corrections: [{section: 'what_worked[0]', outcome: 'removed', note: null, at: ''}],
    });
    mockFetchAudio.mockReturnValue({
      unwrap: () => Promise.resolve({url: 'https://cdn/a.mp3', cached: true}),
    });
    const {getByText, getAllByText, getByTestId} = renderTab();
    await act(async () => {
      fireEvent.press(getByText('postSim.debriefCards.listen.all'));
    });
    expect(mockFetchAudio).toHaveBeenCalledWith({sessionId: 's-1', section: 'important_moment'}, true);
    expect(getByTestId('debrief-read-aloud-player')).toBeTruthy();
    expect(mockPlayer.props.source).toEqual({uri: 'https://cdn/a.mp3'});
    expect(mockPlayer.props.rate).toBe(1);
    expect(getByTestId('debrief-card-important-moment').props.accessibilityState).toEqual({
      selected: true,
    });
    act(() => mockPlayer.props.onLoad());
    // Pause in the header bar, and on the card being read.
    expect(getAllByText('postSim.debriefCards.listen.pause')).toHaveLength(2);
    fireEvent.press(getAllByText('postSim.debriefCards.listen.pause')[0]);
    expect(mockPlayer.props.paused).toBe(true);
    fireEvent.press(getByText('postSim.debriefCards.listen.resume'));
    expect(mockPlayer.props.paused).toBe(false);
    fireEvent.press(getByText('1.25×'));
    expect(mockPlayer.props.rate).toBe(1.25);
    await act(async () => mockPlayer.props.onEnd());
    await act(async () => mockPlayer.props.onEnd());
    // what_worked[0] was removed, so the opening is followed by work_on_this[0].
    expect(mockFetchAudio.mock.calls.map(([arg]) => arg.section)).toEqual([
      'important_moment',
      'opening',
      'work_on_this[0]',
    ]);
  });

  it('says so when the audio can’t be played, and the cards stay', async () => {
    ready();
    mockFetchAudio.mockReturnValue({unwrap: () => Promise.reject(new Error('503'))});
    const {getAllByTestId, getByTestId, getByText} = renderTab();
    await act(async () => {
      fireEvent.press(getAllByTestId('debrief-listen-card')[0]);
    });
    expect(getByTestId('debrief-listen-status')).toBeTruthy();
    expect(getByText('postSim.debriefCards.listen.error')).toBeTruthy();
    expect(getByTestId('debrief-card-opening')).toBeTruthy();
  });

  it('shows the error when the player fails mid-card', async () => {
    ready();
    mockFetchAudio.mockReturnValue({
      unwrap: () => Promise.resolve({url: 'https://cdn/a.mp3', cached: false}),
    });
    const {getByText} = renderTab();
    await act(async () => {
      fireEvent.press(getByText('postSim.debriefCards.listen.all'));
    });
    act(() => mockPlayer.props.onError());
    expect(getByText('postSim.debriefCards.listen.error')).toBeTruthy();
  });

  describe('XP for reading to the end', () => {
    const measureLayout = jest.requireActual('react-native/jest/MockNativeMethods')
      .measureLayout as jest.Mock;

    beforeEach(() => {
      jest.useFakeTimers();
      // The end of the last Work-on-this card sits 1,200 pt into the content.
      measureLayout.mockImplementation((_relativeTo, onSuccess) => onSuccess(0, 1200, 300, 1));
    });

    afterEach(() => {
      measureLayout.mockReset();
      jest.useRealTimers();
    });

    const layout = (renderResult: ReturnType<typeof renderTab>) => {
      fireEvent(renderResult.getByTestId('debrief-cards'), 'layout', {
        nativeEvent: {layout: {x: 0, y: 0, width: 300, height: 700}},
      });
      fireEvent(renderResult.getByTestId('debrief-read-end'), 'layout', {
        nativeEvent: {layout: {x: 0, y: 0, width: 300, height: 1}},
      });
    };
    const scrollTo = (renderResult: ReturnType<typeof renderTab>, y: number) =>
      fireEvent.scroll(renderResult.getByTestId('debrief-cards'), {
        nativeEvent: {contentOffset: {x: 0, y}},
      });

    it('marks the debrief read once the end was on screen and 30 s have passed', () => {
      ready();
      const result = renderTab();
      layout(result);
      scrollTo(result, 600);
      expect(mockMarkRead).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(29_000);
      });
      expect(mockMarkRead).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(mockMarkRead).toHaveBeenCalledTimes(1);
      expect(mockMarkRead).toHaveBeenCalledWith('s-1');
      scrollTo(result, 0);
      scrollTo(result, 600);
      expect(mockMarkRead).toHaveBeenCalledTimes(1);
    });

    it('earns nothing when the end never came into view', () => {
      ready();
      const result = renderTab();
      layout(result);
      scrollTo(result, 200);
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockMarkRead).not.toHaveBeenCalled();
      // Reaching it later still counts.
      scrollTo(result, 520);
      expect(mockMarkRead).toHaveBeenCalledWith('s-1');
    });
  });
});
