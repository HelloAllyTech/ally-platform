import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    ds: {theme: {primary: '#00f', primaryLight: '#aaf'}},
  },
  fontFamily: {ROBOTO: {REGULAR: {}}},
}));

jest.mock('@/hooks/useTranslate', () => {
  const labels: Record<string, string> = {
    'simulationPage.turnIndicator.speaking': 'Speaking...',
    'simulationPage.turnIndicator.listening': 'Listening...',
    'simulationPage.turnIndicator.yourTurnToSpeak': 'Your turn to speak',
    'simulationPage.turnIndicator.yourTurnToListen': 'Your turn to listen',
    'simulationPage.turnIndicator.thinking': 'Thinking...',
    'simulationPage.turnIndicator.paused': 'Paused',
  };
  return {
    useTranslate: () => ({
      t: (key: string) => labels[key] ?? key,
      tVariable: (key: string) => key,
    }),
  };
});

import {TurnState} from '@/types';

import {TurnIndicator} from '../TurnIndicator';

describe('TurnIndicator', () => {
  it('renders the label for a turn state', () => {
    const {getByText} = render(<TurnIndicator turnState={TurnState.AI_SPEAKING} />);
    expect(getByText('Speaking...')).toBeTruthy();
  });

  it('renders nothing for the idle state', () => {
    const {toJSON} = render(<TurnIndicator turnState={TurnState.IDLE} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the same message in compact mode', () => {
    const {getByText} = render(
      <TurnIndicator turnState={TurnState.USER_TURN_TO_LISTEN} compact />,
    );
    expect(getByText('Your turn to listen')).toBeTruthy();
  });
});
