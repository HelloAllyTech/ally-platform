import React from 'react';
import {View} from 'react-native';
import {render} from '@testing-library/react-native';

jest.mock('react-native-keyboard-aware-scroll-view', () => {
  const {ScrollView} = require('react-native');
  return {
    KeyboardAwareScrollView: ScrollView,
  };
});

jest.mock('../../', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationSummary: () => <View testID="simulation-summary" />,
    SimulationSummarySkeleton: () => <View testID="simulation-summary-skeleton" />,
  };
});

import {SummaryTab} from '../SummaryTab';

describe('SummaryTab', () => {
  it('shows skeleton when no details and not retry limit', () => {
    const {getByTestId} = render(
      <SummaryTab simulationDetails={null} retryLimitReached={false} />,
    );
    expect(getByTestId('simulation-summary-skeleton')).toBeTruthy();
  });

  it('shows SimulationSummary when details provided', () => {
    const mockDetails = {
      details: {
        summary: {feedback: {positives: [], improvements: []}},
      },
    } as any;
    const {getByTestId} = render(
      <SummaryTab simulationDetails={mockDetails} retryLimitReached={false} />,
    );
    expect(getByTestId('simulation-summary')).toBeTruthy();
  });

  it('shows SimulationSummary when retryLimitReached', () => {
    const {getByTestId} = render(
      <SummaryTab simulationDetails={null} retryLimitReached={true} />,
    );
    expect(getByTestId('simulation-summary')).toBeTruthy();
  });
});
