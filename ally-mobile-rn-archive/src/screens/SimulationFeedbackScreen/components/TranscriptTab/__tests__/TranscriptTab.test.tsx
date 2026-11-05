import React from 'react';
import {View} from 'react-native';
import {render} from '@testing-library/react-native';

jest.mock('@/hooks/useSimulationSessionRecordingUrl', () => ({
  useSimulationSessionRecordingUrl: () => ({
    url: undefined,
    isInitialLoad: false,
    isMissing: false,
    refreshFromPlaybackError: jest.fn(),
  }),
}));

jest.mock('../../', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationTranscript: (props: any) => (
      <View testID="simulation-transcript" {...props} />
    ),
  };
});

import {TranscriptTab} from '../TranscriptTab';

describe('TranscriptTab', () => {
  it('returns null when no scenarioSessionId', () => {
    const {queryByTestId} = render(
      <TranscriptTab scenarioSessionId="" />,
    );
    expect(queryByTestId('simulation-transcript')).toBeNull();
  });

  it('renders SimulationTranscript when scenarioSessionId provided', () => {
    const {getByTestId} = render(
      <TranscriptTab scenarioSessionId="session-123" />,
    );
    expect(getByTestId('simulation-transcript')).toBeTruthy();
  });
});
