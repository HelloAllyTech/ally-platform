import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

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
jest.mock('@/services', () => ({
  useRecordBranchingResultMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockRecord(args)}),
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
  ...overrides,
});

const setup = (payload = buildPayload()) => {
  const onCompleted = jest.fn();
  const onRequestNext = jest.fn();
  const utils = render(
    <BranchingScenarioPlayer
      payload={payload}
      itemId="item-1"
      onCompleted={onCompleted}
      onRequestNext={onRequestNext}
    />,
  );
  return {...utils, onCompleted, onRequestNext};
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

  it('hides Try again and explains when the server says no attempts are left', async () => {
    mockRecord.mockResolvedValue(result({attemptsLeft: 0, attemptsUsed: 3}));
    const {getByTestId, getByText, queryByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));

    await waitFor(() => expect(getByTestId('branching-exhausted')).toBeTruthy());
    expect(getByText('courses.branching.attemptsUsedUp')).toBeTruthy();
    expect(queryByTestId('branching-try-again')).toBeNull();
  });

  it('shows the same message for a 400 "used all attempts" on the POST', async () => {
    mockRecord.mockRejectedValue({
      status: 400,
      data: {message: 'You have used all attempts'},
    });
    const {getByTestId} = setup();
    fireEvent.press(getByTestId('branching-choice-c1'));
    await waitFor(() => expect(getByTestId('branching-exhausted')).toBeTruthy());
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

  it('blocks play up front when attempts were already used without a pass', () => {
    const {getByTestId, queryByText} = setup(
      buildPayload({attemptsUsed: 3, maxAttempts: 3}),
    );
    expect(getByTestId('branching-exhausted')).toBeTruthy();
    expect(queryByText('Priya sits down.')).toBeNull();
  });
});
