import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationTranscript} from '../SimulationTranscript';

// Avoid importing NetworkLogs through components barrel
jest.mock('@/components/EmptyTranscript/EmptyTranscript', () => ({
  EmptyTranscript: () => null,
}));

jest.mock('@/hooks/useSimulationTranscriptDetails', () => ({
  useSimulationTranscriptDetails: () => ({
    formattedMessages: [
      {id: 1, time: '00:01', message: 'Hello', counselor: true},
      {id: 2, time: '00:02', message: 'Hi', counselor: false},
    ],
    isLoading: true,
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
    const {getByText} = render(
      <SimulationTranscript sessionId="1" startedAt="2024-01-01T00:00:00Z" />,
    );
    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Hi')).toBeTruthy();
  });
});


