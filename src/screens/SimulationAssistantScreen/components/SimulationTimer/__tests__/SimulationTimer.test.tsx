import React from 'react';
import {act, render} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationTimer} from '../SimulationTimer';

jest.useFakeTimers();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

const renderWithProviders = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, left: 0, right: 0, bottom: 0},
      }}>
      {ui}
    </SafeAreaProvider>,
  );

describe('SimulationTimer', () => {
  it('renders elapsed time starting at 00:00 and ticks each second', () => {
    const base = new Date('2024-01-01T00:00:00.000Z');
    jest.setSystemTime(base);
    const start = new Date(base);
    const {getByText} = renderWithProviders(
      <SimulationTimer startTime={start} />,
    );

    // Initially 00:00
    getByText(/simulationPage\.sessionDuration/);
    getByText('00:00');

    // Advance 3 seconds and system time
    act(() => {
      jest.advanceTimersByTime(3000);
      jest.setSystemTime(new Date(base.getTime() + 3000));
    });
    getByText('00:03');
  });
});


