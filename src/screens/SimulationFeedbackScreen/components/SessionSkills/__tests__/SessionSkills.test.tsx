import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SessionSkills} from '../SessionSkills';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/services/simulationSummaryApi', () => ({
  useGetSimulationSkillsQuery: jest.fn(),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    CircularProgress: ({children}: any) =>
      React.createElement(View, {testID: 'circular-progress'}, children),
    CustomLineChart: () =>
      React.createElement(View, {testID: 'custom-line-chart'}),
    NetworkImage: () =>
      React.createElement(View, {testID: 'network-image'}),
    ProgressBar: () =>
      React.createElement(View, {testID: 'progress-bar'}),
  };
});

jest.mock('@/utils', () => ({
  calculateAverageForObjectArray: (arr: {percentage: number}[], _key: string) =>
    arr?.length ? arr.reduce((s, i) => s + i.percentage, 0) / arr.length : 0,
  formatSecondsToMMSS: (s: number) => `${Math.floor(s / 60)}:${s % 60}`,
}));

jest.mock('@/constants', () => ({
  DEFAULT_DATA_POINTS: [{x: 0, y: -6}],
  DEFAULT_SKILL_COVERAGE: [
    {category: 'Learning', percentage: 50, iconUrl: ''},
    {category: 'Support', percentage: 75, iconUrl: ''},
  ],
  NUM_X_AXIS_INTERVALS: 4,
  NUM_Y_AXIS_INTERVALS: 4,
  SKILL_COLORS: ['#purple', '#green', '#orange'],
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BulbIcon: () => React.createElement(View, {testID: 'bulb-icon'}),
  };
});

const mockUseGetSimulationSkillsQuery =
  require('@/services/simulationSummaryApi').useGetSimulationSkillsQuery;

const defaultProps = {
  scenarioSessionId: 'session-1',
};

describe('SessionSkills', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetSimulationSkillsQuery.mockReturnValue({
      data: {
        skillCoverage: [
          {category: 'Learning', percentage: 50, iconUrl: ''},
          {category: 'Support', percentage: 75, iconUrl: ''},
        ],
        emotionalMovement: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('shows loading indicator when loading', () => {
    mockUseGetSimulationSkillsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: jest.fn(),
    });

    const {getByTestId, UNSAFE_getAllByType} = render(
      <SessionSkills {...defaultProps} />,
    );
    const {ActivityIndicator} = require('react-native');
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });

  it('shows error text when error', () => {
    mockUseGetSimulationSkillsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: jest.fn(),
    });

    const {getByText} = render(<SessionSkills {...defaultProps} />);
    expect(
      getByText('SimulationFeedback.sessionSkills.errorLoading'),
    ).toBeTruthy();
  });

  it('renders overall score percentage', () => {
    const {getByText} = render(<SessionSkills {...defaultProps} />);
    // 50 and 75 avg = 62.5, rounded in display
    expect(getByText(/62\.5%|62%/)).toBeTruthy();
  });

  it('renders skill items with names and percentages', () => {
    const {getByText} = render(<SessionSkills {...defaultProps} />);
    expect(getByText('Learning')).toBeTruthy();
    expect(getByText('Support')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
    expect(getByText('75%')).toBeTruthy();
  });
});
