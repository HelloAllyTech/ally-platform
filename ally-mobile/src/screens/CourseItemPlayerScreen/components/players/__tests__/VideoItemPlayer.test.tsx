import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {TrackItemType} from '@/types';

import {VideoItemPlayer} from '../VideoItemPlayer';

jest.mock('@/hooks', () => {
  const actual = jest.requireActual('@/hooks/useVideoWatchProgress');
  return {
    useVideoWatchProgress: actual.useVideoWatchProgress,
    useTranslate: jest.fn(() => ({
      t: (key: string) => key,
      tVariable: (key: string) => key,
    })),
  };
});

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    Button: ({label, onPress, isDisabled, testID}: any) => (
      <RN.TouchableOpacity testID={testID} onPress={onPress} disabled={isDisabled}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

let lastVideoProps: any = null;
jest.mock('react-native-video', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      lastVideoProps = props;
      return <RN.View testID={props.testID} />;
    },
  };
});

const mockReportVideoProgress = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({
    completed: false,
    unlockedItemIds: [],
    sectionCompleted: false,
    trackCompleted: false,
    maxWatchedPct: 40,
  }),
}));

const mockSubmitInterjectionAnswer = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({
    correct: true,
    grading: {
      questionId: 'q1',
      correct: true,
      pointsAwarded: 1,
      pointsPossible: 1,
    },
  }),
}));

jest.mock('@/services', () => ({
  useReportVideoProgressMutation: jest.fn(() => [mockReportVideoProgress]),
  useSubmitInterjectionAnswerMutation: jest.fn(() => [
    mockSubmitInterjectionAnswer,
    {isLoading: false},
  ]),
}));

const buildPayload = (source: 's3' | 'youtube' | 'loom' = 's3') => ({
  type: TrackItemType.VIDEO as const,
  trackItemProgressId: 'progress-1',
  source,
  url: 'https://example.com/video.mp4',
  durationSeconds: 100,
  requiredWatchPct: 80,
  maxWatchedPct: 0,
});

describe('VideoItemPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastVideoProps = null;
  });

  it('renders the native player for an s3 source', () => {
    const {getByTestId} = render(
      <VideoItemPlayer
        payload={buildPayload('s3')}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );
    expect(getByTestId('course-video-player')).toBeTruthy();
  });

  it('renders the fallback card for a non-s3 source, with no native player', () => {
    const {getByTestId, queryByTestId} = render(
      <VideoItemPlayer
        payload={buildPayload('youtube')}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );
    expect(queryByTestId('course-video-player')).toBeNull();
    expect(getByTestId('video-open-external')).toBeTruthy();
    expect(getByTestId('video-mark-watched')).toBeTruthy();
  });

  it('reports progress through onProgress and marks completed when the server says so', async () => {
    mockReportVideoProgress.mockReturnValue({
      unwrap: jest.fn().mockResolvedValue({
        completed: true,
        unlockedItemIds: [],
        sectionCompleted: false,
        trackCompleted: false,
        maxWatchedPct: 90,
      }),
    } as any);

    const {getByText} = render(
      <VideoItemPlayer
        payload={buildPayload('s3')}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    // Simulate continuous playback (1s steps, so each crosses the "seek"
    // threshold check) until unique watched seconds cross the 10-point
    // immediate-report delta (11/100 = 11%).
    act(() => {
      for (let t = 0; t <= 11; t++) {
        lastVideoProps.onProgress({
          currentTime: t,
          playableDuration: 100,
          seekableDuration: 100,
        });
      }
    });

    await waitFor(() =>
      expect(mockReportVideoProgress).toHaveBeenCalledWith(
        expect.objectContaining({itemId: 'item-1', trackId: 'track-1'}),
      ),
    );
    await waitFor(() => expect(getByText('courses.video.watched')).toBeTruthy());
  });

  it('marking watched on the fallback card reports 100%', async () => {
    const {getByTestId} = render(
      <VideoItemPlayer
        payload={buildPayload('loom')}
        itemId="item-1"
        trackId="track-1"
        alreadyCompleted={false}
      />,
    );

    fireEvent.press(getByTestId('video-mark-watched'));

    await waitFor(() =>
      expect(mockReportVideoProgress).toHaveBeenCalledWith({
        itemId: 'item-1',
        trackId: 'track-1',
        watchedPct: 100,
      }),
    );
  });
});
