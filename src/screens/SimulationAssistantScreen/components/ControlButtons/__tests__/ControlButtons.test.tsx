import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {ControlButtons} from '../ControlButtons';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets', () => ({
  __esModule: true,
  MicOffIcon: () => null,
  MicOnIcon: () => null,
}));

describe('ControlButtons', () => {
  it('renders mute/unmute label based on isMuted and triggers callbacks', () => {
    const onMicPress = jest.fn();
    const onStopPress = jest.fn();

    const {getByText, rerender} = render(
      <ControlButtons
        onMicPress={onMicPress}
        onStopPress={onStopPress}
        isMuted={false}
      />,
    );

    // When not muted
    getByText('SimulationAssistant.mute');

    // Press mic and stop
    fireEvent.press(getByText('SimulationAssistant.mute'));
    fireEvent.press(getByText('SimulationAssistant.endSession'));
    expect(onMicPress).toHaveBeenCalled();
    expect(onStopPress).toHaveBeenCalled();

    // Rerender as muted
    rerender(
      <ControlButtons
        onMicPress={onMicPress}
        onStopPress={onStopPress}
        isMuted
      />,
    );
    getByText('SimulationAssistant.unmute');
  });

  it('respects disabled states', () => {
    const onMicPress = jest.fn();
    const onStopPress = jest.fn();
    const {getByText} = render(
      <ControlButtons
        onMicPress={onMicPress}
        onStopPress={onStopPress}
        isMuted={false}
        isDisableMic
        isDisableStop
      />,
    );

    fireEvent.press(getByText('SimulationAssistant.mute'));
    fireEvent.press(getByText('SimulationAssistant.endSession'));
    expect(onMicPress).not.toHaveBeenCalled();
    expect(onStopPress).not.toHaveBeenCalled();
  });
});


