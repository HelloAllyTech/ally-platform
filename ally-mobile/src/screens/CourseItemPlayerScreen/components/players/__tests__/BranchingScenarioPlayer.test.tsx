import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {BranchingNode, TrackItemType} from '@/types';

import {BranchingScenarioPlayer} from '../BranchingScenarioPlayer';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    tVariable: (key: string) => key,
  })),
}));

// The global Button mock collapses every testID; keep the real ones.
jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

const mockRecord = jest.fn();
const mockStart = jest.fn();
jest.mock('@/services', () => ({
  useRecordBranchingResultMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockRecord(args)}),
    {isLoading: false},
  ]),
  useStartTrackItemMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockStart(args)}),
    {isLoading: false},
  ]),
}));

const completion = {
  completed: true,
  unlockedItemIds: ['next'],
  sectionCompleted: false,
  trackCompleted: false,
};

const nodes: BranchingNode[] = [
  {
    id: 'start',
    text: 'Priya sits down.',
    image: {url: 'https://x/y.png', alt: 'A woman sitting'},
    choices: [
      {id: 'c1', text: 'Reassure her', nextNodeId: 'quiet'},
      {id: 'c2', text: 'Reflect', nextNodeId: 'open'},
    ],
  },
  {
    id: 'quiet',
    title: 'Rapport stalls',
    text: 'She goes quiet.',
    outcome: 'MIXED',
    score: 50,
    takeaway: 'Name the feeling first.',
  },
  {id: 'open', text: 'She opens up.', outcome: 'POSITIVE', score: 100},
];

const buildPayload = (overrides = {}) => ({
  type: TrackItemType.BRANCHING_SCENARIO as const,
  trackItemProgressId: 'progress-1',
  intro: 'Practice a hard moment.',
  startNodeId: 'start',
  nodes,
  passScore: 70,
  maxAttempts: 3,
  attemptsUsed: 0,
  bestScore: null,
  completed: false,
  endingsReached: [],
  exhausted: false,
  nextRoundAt: null,
  recap: [],
  ...overrides,
});

const result = (overrides = {}) => ({
  endingNodeId: 'quiet',
  score: 50,
  passScore: 70,
  passed: false,
  attemptsUsed: 1,
  maxAttempts: 3,
  attemptsLeft: 2,
  bestScore: 50,
  endingsReached: ['quiet'],
  itemCompleted: false,
  completion: null,
  exhausted: false,
  nextRoundAt: null,
  recap: [],
  ...overrides,
});

const iso = (ms: number) => new Date(ms).toISOString();
const recapOf = (...ids: string[]) =>
  ids.map((endingNodeId, i) => ({
    endingNodeId,
    score: endingNodeId === 'open' ? 100 : 50,
    at: iso(Date.now() - (ids.length - i) * 60_000),
  }));

const setup = (payload = buildPayload()) => {
  const onCompleted = jest.fn();
  const onRequestNext = jest.fn();
  const onBack = jest.fn();
  const utils = render(
    <BranchingScenarioPlayer
      payload={payload}
      itemId="item-1"
      onCompleted={onCompleted}
      onRequestNext={onRequestNext}
      onBack={onBack}
    />,
  );
  return {...utils, onCompleted, onRequestNext, onBack};
};

describe('BranchingScenarioPlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the intro, the start scene, its image alt and the choices', () => {
    const {getByText, getByLabelText} = setup();
    expect(getByText('Practice a hard moment.')).toBeTruthy();
    expect(getByText('Priya sits down.')).toBeTruthy();
    expect(getByLabelText('A woman sitting')).toBeTruthy();
    expect(getByText('Reassure her')).toBeTruthy();
    expect(getByText('Reflect')).toBeTruthy();
  });

  it('shows how many endings were seen on reopen', () => {
    const {getByTestId} = setup(buildPayload({endingsReached: ['open']}));
    expect(getByTestId('branching-endings-seen').props.children).toBeTruthy();
  });

  it('advances to the next scene on a choice, with no back', () => {
    mockRecord.mockResolvedValue(result());
    const {getByTestId, getByText, queryByText} = setup(
      buildPayload({
        nodes: [
          nodes[0],
          {
            id: 'quiet',
            text: 'Another decision.',
            choices: [{id: 'c3', text: 'Go on', nextNodeId: 'open'}],
          },
          nodes[2],
        ],
      }),
    );
    fireEvent.press(getByTestId('branching-choice-c1'));
    expect(getByText('Another decision.')).toBeTruthy();
    expect(getByText('courses.branching.youChose:{"text":"Reassure her"}')).toBeTruthy();
    expect(queryByText('Priya sits down.')).toBeNull();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('posts the chosen path at an ending and shows the server score, not passed, with try again', async () => {
    mockRecord.mockResolvedValue(result());
    const {getByTestId, getByText, queryByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() =>
      expect(mockRecord).toHaveBeenCalledWith({itemId: 'item-1', path: ['c1']}),
    );
    await waitFor(() => expect(getByTestId('branching-score')).toBeTruthy());
    expect(getByText('Name the feeling first.')).toBeTruthy();
    expect(getByText('courses.branching.notPassed')).toBeTruthy();
    expect(getByText('courses.branching.score:{"score":50}')).toBeTruthy();
    expect(queryByTestId('branching-continue')).toBeNull();

    fireEvent.press(getByTestId('branching-try-again'));
    expect(getByText('Priya sits down.')).toBeTruthy();
  });

  it('passing reports completion and offers Continue', async () => {
    mockRecord.mockResolvedValue(
      result({
        endingNodeId: 'open',
        score: 100,
        passed: true,
        itemCompleted: true,
        attemptsLeft: 1,
        completion,
      }),
    );
    const {getByTestId, onCompleted, onRequestNext} = setup();
    fireEvent.press(getByTestId('branching-choice-c2'));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(completion));
    fireEvent.press(getByTestId('branching-continue'));
    expect(onRequestNext).toHaveBeenCalled();
  });

  it('switches to the exhausted screen with a recap after the final failed run', async () => {
    const nextRoundAt = iso(Date.now() + 23 * 3_600_000);
    mockRecord.mockResolvedValue(
      result({
        attemptsLeft: 0,
        attemptsUsed: 3,
        exhausted: true,
        nextRoundAt,
        recap: recapOf('quiet', 'quiet', 'quiet'),
      }),
    );
    const {getByTestId, getAllByTestId, queryByTestId, queryByText} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() => expect(getByTestId('branching-exhausted')).toBeTruthy());
    expect(getAllByTestId('branching-recap-row')).toHaveLength(3);
    expect(queryByTestId('branching-try-again')).toBeNull();
    expect(queryByTestId('branching-start-round')).toBeNull();
    expect(queryByText('Priya sits down.')).toBeNull();
  });

  it('shows the recap rows when the item opens already exhausted', () => {
    const {getByTestId, getAllByTestId, getByText, getAllByText, queryByText, onBack} =
      setup(
        buildPayload({
          attemptsUsed: 2,
          maxAttempts: 2,
          exhausted: true,
          nextRoundAt: iso(Date.now() + 23.4 * 3_600_000),
          recap: recapOf('quiet', 'open'),
        }),
      );
    expect(getByTestId('branching-exhausted')).toBeTruthy();
    expect(
      getByText(
        String.raw`courses.branching.newRoundIn:{"time":"courses.branching.untilHours:{\"count\":23}"}`,
      ),
    ).toBeTruthy();
    expect(getAllByTestId('branching-recap-row')).toHaveLength(2);
    expect(getByText('She goes quiet.')).toBeTruthy();
    expect(getByText('She opens up.')).toBeTruthy();
    expect(getByText('Name the feeling first.')).toBeTruthy();
    expect(getAllByText('courses.branching.outcome.MIXED')).toHaveLength(1);
    expect(getByText('courses.branching.score:{"score":50}')).toBeTruthy();
    expect(queryByText('Priya sits down.')).toBeNull();
    fireEvent.press(getByTestId('branching-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('omits scores in the recap when there is no pass mark', () => {
    const {queryByText} = setup(
      buildPayload({
        passScore: null,
        exhausted: true,
        nextRoundAt: iso(Date.now() + 3_600_000),
        recap: recapOf('quiet'),
      }),
    );
    expect(queryByText(/courses.branching.score/)).toBeNull();
  });

  it('on a 400 "used all attempts" re-fetches the item and shows the exhausted screen', async () => {
    mockRecord.mockRejectedValue({
      status: 400,
      data: {message: 'You have used all attempts for this scenario.'},
    });
    mockStart.mockResolvedValue(
      buildPayload({
        exhausted: true,
        nextRoundAt: iso(Date.now() + 5 * 3_600_000),
        recap: recapOf('quiet'),
      }),
    );
    const {getByTestId, getAllByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() => expect(getByTestId('branching-exhausted')).toBeTruthy());
    expect(mockStart).toHaveBeenCalledWith({itemId: 'item-1'});
    expect(getAllByTestId('branching-recap-row')).toHaveLength(1);
  });

  it('falls back to the plain message when that re-fetch fails', async () => {
    mockRecord.mockRejectedValue({
      status: 400,
      data: {message: 'You have used all attempts for this scenario.'},
    });
    mockStart.mockRejectedValue({status: 500});
    const {getByTestId, queryByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() =>
      expect(getByTestId('branching-exhausted-plain')).toBeTruthy(),
    );
    expect(queryByTestId('branching-try-again')).toBeNull();
  });

  describe('when the new round opens', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('offers Start a new round, which re-fetches and returns to the first scene', async () => {
      mockStart.mockResolvedValue(buildPayload());
      const {getByTestId, queryByTestId, getByText} = setup(
        buildPayload({
          exhausted: true,
          nextRoundAt: iso(Date.now() + 2 * 60_000),
          recap: recapOf('quiet'),
        }),
      );
      expect(queryByTestId('branching-start-round')).toBeNull();

      // One act per tick: the effect re-arms its timer after each render.
      for (let i = 0; i < 3; i++) {
        act(() => {
          jest.advanceTimersByTime(60_000);
        });
      }
      expect(getByTestId('branching-start-round')).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId('branching-start-round'));
      });
      expect(mockStart).toHaveBeenCalledWith({itemId: 'item-1'});
      expect(getByText('Priya sits down.')).toBeTruthy();
      expect(queryByTestId('branching-exhausted')).toBeNull();
    });
  });

  it('offers a retry when saving fails for another reason', async () => {
    mockRecord.mockRejectedValueOnce({status: 500});
    mockRecord.mockResolvedValueOnce(result());
    const {getByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() => expect(getByTestId('branching-retry-save')).toBeTruthy());
    fireEvent.press(getByTestId('branching-retry-save'));
    await waitFor(() => expect(getByTestId('branching-score')).toBeTruthy());
  });

  it('shows no score UI when there is no pass mark', async () => {
    mockRecord.mockResolvedValue(
      result({passScore: null, passed: true, itemCompleted: true, completion}),
    );
    const {getByTestId, queryByTestId} = setup(buildPayload({passScore: null}));
    fireEvent.press(getByTestId('branching-choice-c1'));
    await waitFor(() => expect(getByTestId('branching-continue')).toBeTruthy());
    expect(queryByTestId('branching-score')).toBeNull();
  });
});
