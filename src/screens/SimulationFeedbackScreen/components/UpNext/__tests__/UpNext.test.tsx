import React from 'react';
import {View} from 'react-native';
import {render} from '@testing-library/react-native';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useSimulationTransition: jest.fn(),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    Button: ({label, testID}: any) => <View testID={testID || 'button'} accessibilityLabel={label} />,
    SimulationTransitionSection: () => <View testID="simulation-transition-section" />,
  };
});

jest.mock('../../SessionGlimpse', () => ({
  SessionGlimpse: () => null,
}));

jest.mock('../../SummaryCard', () => ({
  SummaryCard: ({children}: any) => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="summary-card">{children}</View>;
  },
}));

import {useSimulationTransition} from '@/hooks';
import {UpNext} from '../UpNext';

const mockUseSimulationTransition = useSimulationTransition as jest.Mock;

describe('UpNext', () => {
  const defaultProps = {
    scenarioSessionId: 'session-123',
    onFinish: jest.fn(),
    onBack: jest.fn(),
  };

  beforeEach(() => {
    mockUseSimulationTransition.mockReturnValue({
      currentSession: null,
      upcomingScenario: null,
      isEventCompleted: false,
      isFlowCompleted: false,
      hasUpcoming: false,
      canRetryCurrentSession: false,
      isCurrentSessionCompleted: false,
      retrySimulation: jest.fn(),
      startNextSimulation: jest.fn(),
      isStartingSimulation: false,
    });
  });

  it('renders without crashing', () => {
    const {getByTestId} = render(<UpNext {...defaultProps} />);
    expect(getByTestId('summary-card')).toBeTruthy();
    expect(getByTestId('simulation-transition-section')).toBeTruthy();
  });

  it('shows Finish button when flow completed', () => {
    mockUseSimulationTransition.mockReturnValue({
      currentSession: null,
      upcomingScenario: null,
      isEventCompleted: true,
      isFlowCompleted: true,
      hasUpcoming: false,
      canRetryCurrentSession: false,
      isCurrentSessionCompleted: false,
      retrySimulation: jest.fn(),
      startNextSimulation: jest.fn(),
      isStartingSimulation: false,
    });

    const {getByLabelText} = render(
      <UpNext {...defaultProps} pathId="path-1" />,
    );
    expect(getByLabelText('Common.finish')).toBeTruthy();
  });

  it('shows Back button when event completed but flow not completed', () => {
    mockUseSimulationTransition.mockReturnValue({
      currentSession: null,
      upcomingScenario: null,
      isEventCompleted: true,
      isFlowCompleted: false,
      hasUpcoming: false,
      canRetryCurrentSession: true,
      isCurrentSessionCompleted: false,
      retrySimulation: jest.fn(),
      startNextSimulation: jest.fn(),
      isStartingSimulation: false,
    });

    const {getByLabelText} = render(
      <UpNext {...defaultProps} pathId="path-1" />,
    );
    expect(getByLabelText('Common.back')).toBeTruthy();
  });

  it('returns no buttons when no pathId/caseId', () => {
    mockUseSimulationTransition.mockReturnValue({
      currentSession: null,
      upcomingScenario: null,
      isEventCompleted: true,
      isFlowCompleted: true,
      hasUpcoming: false,
      canRetryCurrentSession: false,
      isCurrentSessionCompleted: false,
      retrySimulation: jest.fn(),
      startNextSimulation: jest.fn(),
      isStartingSimulation: false,
    });

    const {queryByLabelText} = render(<UpNext {...defaultProps} />);
    expect(queryByLabelText('Common.finish')).toBeNull();
    expect(queryByLabelText('Common.back')).toBeNull();
  });
});
