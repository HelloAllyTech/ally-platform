import React from 'react';
import {View} from 'react-native';
import {render} from '@testing-library/react-native';

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
      <TranscriptTab
        scenarioSessionId=""
        setReviewId={jest.fn()}
      />,
    );
    expect(queryByTestId('simulation-transcript')).toBeNull();
  });

  it('renders SimulationTranscript when scenarioSessionId provided', () => {
    const {getByTestId} = render(
      <TranscriptTab
        scenarioSessionId="session-123"
        setReviewId={jest.fn()}
      />,
    );
    expect(getByTestId('simulation-transcript')).toBeTruthy();
  });
});
