import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('../../SimulationAudioPlayer/SimulationAudioPlayer', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationAudioPlayer: () => <View testID="simulation-audio-player" />,
  };
});

import {SimulationTranscript} from '../SimulationTranscript';

// Avoid importing NetworkLogs through components barrel
jest.mock('@/components/EmptyTranscript/EmptyTranscript', () => ({
  EmptyTranscript: () => null,
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: jest.fn().mockImplementation(selector =>
    selector({
      user: {
        user: {
          name: 'Test User',
        },
      },
    }),
  ),
}));

jest.mock('@/hooks/useSimulationTranscriptDetails', () => ({
  useSimulationTranscriptDetails: () => ({
    formattedMessages: [
      {id: 1, time: '00:01', message: 'Hello', learner: true, startSeconds: 1},
      {id: 2, time: '00:02', message: 'Hi', learner: false, startSeconds: 2},
      {id: 3, time: '00:03', message: 'Test', learner: true, startSeconds: 3},
      {id: 4, time: '00:04', message: 'Test2', learner: false, startSeconds: 4},
      {id: 5, time: '00:05', message: 'Test3', learner: true, startSeconds: 5},
      {id: 6, time: '00:06', message: 'Test4', learner: false, startSeconds: 6},
    ],
    isLoading: true,
    isFetching: false,
    hasMore: false,
    listRef: {current: null},
    handleEndReached: jest.fn(),
  }),
}));

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

describe('SimulationTranscript', () => {
  it('renders transcript items and loading footer', () => {
    const {getByText, getByTestId} = render(
      <SimulationTranscript
        sessionId="1"
        startedAt="2024-01-01T00:00:00Z"
        audioUrl="https://example.com/recording.ogg"
      />,
    );
    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Hi')).toBeTruthy();
    expect(getByTestId('simulation-audio-player')).toBeTruthy();
  });

  it('shows message when no recording URL', () => {
    const {getByText, queryByTestId} = render(
      <SimulationTranscript sessionId="1" startedAt="2024-01-01T00:00:00Z" />,
    );
    expect(
      getByText('postSim.noSessionRecording'),
    ).toBeTruthy();
    expect(queryByTestId('simulation-audio-player')).toBeNull();
  });
});


