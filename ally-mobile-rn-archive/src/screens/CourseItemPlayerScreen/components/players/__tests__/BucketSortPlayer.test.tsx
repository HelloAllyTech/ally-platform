import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {StartBucketSortItemPayload, TrackItemType} from '@/types';

import {BucketSortPlayer} from '../BucketSortPlayer';

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

const mockPlace = jest.fn();
const mockRestart = jest.fn();
const mockStart = jest.fn();
jest.mock('@/services', () => ({
  usePlaceBucketSortItemMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockPlace(args)}),
    {isLoading: false},
  ]),
  useRestartBucketSortMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockRestart(args)}),
    {isLoading: false},
  ]),
  useStartTrackItemMutation: jest.fn(() => [
    (args: unknown) => ({unwrap: () => mockStart(args)}),
    {isLoading: false},
  ]),
}));

const completion = {
  completed: true,
  unlockedItemIds: [],
  sectionCompleted: true,
  trackCompleted: true,
};

const payload = (
  over: Partial<StartBucketSortItemPayload['bucketSort']> = {},
): StartBucketSortItemPayload => ({
  type: TrackItemType.BUCKET_SORT,
  trackItemProgressId: 'p1',
  rounds: 0,
  bestFirstTryPct: null,
  bucketSort: {
    intro: 'Sort these.',
    buckets: [
      {id: 'b1', label: 'Helps'},
      {id: 'b2', label: 'Harms'},
    ],
    items: [
      {id: 'i1', text: 'Reflect feelings'},
      {id: 'i2', text: 'Give advice fast'},
    ],
    answered: {},
    ...over,
  },
});

const reply = (over: Record<string, unknown> = {}) => ({
  sortItemId: 'i1',
  correct: true,
  placedBucketId: 'b1',
  correctBucketId: 'b1',
  explanation: null,
  placedCount: 1,
  totalCount: 2,
  finished: false,
  firstTryPct: null,
  itemCompleted: false,
  completion: null,
  ...over,
});

const setup = (p = payload()) => {
  const onCompleted = jest.fn();
  const onRequestNext = jest.fn();
  const utils = render(
    <BucketSortPlayer
      payload={p}
      itemId="item-1"
      onCompleted={onCompleted}
      onRequestNext={onRequestNext}
    />,
  );
  return {...utils, onCompleted, onRequestNext};
};

describe('BucketSortPlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the verdict, the right bucket and the explanation, then advances', async () => {
    mockPlace.mockResolvedValue(
      reply({correct: false, placedBucketId: 'b2', explanation: 'Because.'}),
    );
    const {getByTestId, getByText, queryByText, queryByTestId} = setup();
    expect(getByText('Reflect feelings')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('bucket-b2'));
    });

    expect(mockPlace).toHaveBeenCalledWith({
      itemId: 'item-1',
      sortItemId: 'i1',
      bucketId: 'b2',
    });
    await waitFor(() => getByTestId('bucket-sort-feedback'));
    expect(getByText('courses.bucketSort.notQuite')).toBeTruthy();
    expect(getByText('Because.')).toBeTruthy();
    // The red bucket names the item that was put there wrongly.
    expect(getByTestId('bucket-sort-misplaced')).toBeTruthy();

    // Buckets are locked while the feedback is being read.
    mockPlace.mockClear();
    fireEvent.press(getByTestId('bucket-b1'));
    expect(mockPlace).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('bucket-sort-next'));
    expect(getByText('Give advice fast')).toBeTruthy();
    expect(queryByText('Reflect feelings')).toBeTruthy(); // settled in its bucket
    expect(queryByTestId('bucket-sort-misplaced')).toBeNull();
  });

  it('holds completion until "See results", then shows the summary', async () => {
    mockPlace
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(
        reply({
          sortItemId: 'i2',
          placedBucketId: 'b2',
          correctBucketId: 'b2',
          finished: true,
          completion,
        }),
      );
    const {getByTestId, getByText, onCompleted} = setup();

    await act(async () => {
      fireEvent.press(getByTestId('bucket-b1'));
    });
    await waitFor(() => getByTestId('bucket-sort-next'));
    fireEvent.press(getByTestId('bucket-sort-next'));
    await act(async () => {
      fireEvent.press(getByTestId('bucket-b2'));
    });
    await waitFor(() => getByText('courses.bucketSort.seeResults'));
    expect(onCompleted).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('bucket-sort-next'));
    expect(onCompleted).toHaveBeenCalledWith(completion);
    expect(getByTestId('bucket-sort-results')).toBeTruthy();
    expect(getByText('courses.bucketSort.allRight')).toBeTruthy();
  });

  it('resumes a finished round and starts another on "Sort again"', async () => {
    const answered = {
      i1: {
        correct: false,
        placedBucketId: 'b2',
        correctBucketId: 'b1',
        explanation: 'Why.',
      },
      i2: {
        correct: true,
        placedBucketId: 'b2',
        correctBucketId: 'b2',
        explanation: null,
      },
    };
    mockRestart.mockResolvedValue({success: true});
    mockStart.mockResolvedValue(payload());
    const {getByTestId, getByText, queryByTestId, onRequestNext} = setup(
      payload({answered}),
    );

    expect(getByTestId('bucket-sort-results')).toBeTruthy();
    expect(getByText('courses.bucketSort.firstTry:{"pct":50}')).toBeTruthy();
    expect(getByText('Why.')).toBeTruthy();

    fireEvent.press(getByTestId('bucket-sort-continue'));
    expect(onRequestNext).toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId('bucket-sort-restart'));
    });
    await waitFor(() => expect(queryByTestId('bucket-sort-results')).toBeNull());
    expect(mockRestart).toHaveBeenCalledWith({itemId: 'item-1'});
    expect(getByText('Reflect feelings')).toBeTruthy();
  });

  it('says so when a placement fails and lets the learner retry', async () => {
    mockPlace.mockRejectedValueOnce(new Error('network'));
    const {getByTestId, getByText} = setup();
    await act(async () => {
      fireEvent.press(getByTestId('bucket-b1'));
    });
    await waitFor(() => getByText('courses.bucketSort.placeFailed'));

    mockPlace.mockResolvedValueOnce(reply());
    await act(async () => {
      fireEvent.press(getByTestId('bucket-b1'));
    });
    await waitFor(() => getByTestId('bucket-sort-feedback'));
  });
});
