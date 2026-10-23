import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationTransitionSection} from '../SimulationTransitionSection';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_target, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const deepProxy = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {
    __esModule: true,
    colors: deepProxy,
    fontFamily: deepProxy,
    typography: deepProxy,
  };
});

jest.mock('../UpNextSimulationCard', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    UpNextSimulationCard: ({upNext}: any) => (
      <View testID="up-next-card">
        <Text>{upNext.title}</Text>
      </View>
    ),
  };
});

const baseProps = {
  isEventCompleted: true,
  isFlowCompleted: false,
  hasUpcoming: true,
  canRetryCurrentSession: false,
  isCurrentSessionCompleted: true,
};

describe('SimulationTransitionSection', () => {
  it('returns null when event is not completed', () => {
    const {toJSON} = render(
      <SimulationTransitionSection {...baseProps} isEventCompleted={false} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders transition message when currentSession has message', () => {
    const {getByText} = render(
      <SimulationTransitionSection
        {...baseProps}
        currentSession={{
          transitionMessageTitle: 'Great job!',
          transitionMessageContent: 'You completed the simulation.',
        } as any}
      />,
    );

    expect(getByText('Great job!')).toBeTruthy();
    expect(getByText('You completed the simulation.')).toBeTruthy();
  });

  it('renders UpNextSimulationCard when session is completed and upcoming exists', () => {
    const {getByTestId, getByText} = render(
      <SimulationTransitionSection
        {...baseProps}
        isCurrentSessionCompleted={true}
        upcomingScenario={{title: 'Next Sim', id: 1} as any}
      />,
    );

    expect(getByTestId('up-next-card')).toBeTruthy();
    expect(getByText('Next Sim')).toBeTruthy();
  });

  it('does not render UpNextSimulationCard when session is not completed', () => {
    const {queryByTestId} = render(
      <SimulationTransitionSection
        {...baseProps}
        isCurrentSessionCompleted={false}
        upcomingScenario={{title: 'Next Sim', id: 1} as any}
      />,
    );

    expect(queryByTestId('up-next-card')).toBeNull();
  });

  it('does not render UpNextSimulationCard when no upcoming scenario', () => {
    const {queryByTestId} = render(
      <SimulationTransitionSection
        {...baseProps}
        isCurrentSessionCompleted={true}
        upcomingScenario={undefined}
      />,
    );

    expect(queryByTestId('up-next-card')).toBeNull();
  });

  it('renders almost-there message when flow not completed, no upcoming, and can retry', () => {
    const {getByText} = render(
      <SimulationTransitionSection
        {...baseProps}
        isFlowCompleted={false}
        hasUpcoming={false}
        canRetryCurrentSession={true}
        almostThereTitle="Almost there!"
        almostThereDescription="Try again to complete the path."
      />,
    );

    expect(getByText('Almost there!')).toBeTruthy();
    expect(getByText('Try again to complete the path.')).toBeTruthy();
  });

  it('does not render almost-there message when flow is completed', () => {
    const {queryByText} = render(
      <SimulationTransitionSection
        {...baseProps}
        isFlowCompleted={true}
        hasUpcoming={false}
        canRetryCurrentSession={true}
        almostThereTitle="Almost there!"
      />,
    );

    expect(queryByText('Almost there!')).toBeNull();
  });

  it('does not render almost-there message when has upcoming', () => {
    const {queryByText} = render(
      <SimulationTransitionSection
        {...baseProps}
        isFlowCompleted={false}
        hasUpcoming={true}
        canRetryCurrentSession={true}
        almostThereTitle="Almost there!"
      />,
    );

    expect(queryByText('Almost there!')).toBeNull();
  });
});
