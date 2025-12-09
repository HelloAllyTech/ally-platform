import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {ControlButtons} from '../ControlButtons';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets', () => ({
  __esModule: true,
  ChevronDown: () => null,
  MicIcon: () => null,
  ShieldIcon: () => null,
  MicOffIcon: () => null,
  MicOnIcon: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  }),
}));

describe('ControlButtons', () => {
  const defaultProps = {
    isMaximized: true,
    onToggleMaximized: jest.fn(),
    isFocusMode: false,
    onFocusModeButtonPress: jest.fn(),
    isSimulationEndDisabled: false,
    onSimulationEndPress: jest.fn(),
    isMicDisabled: false,
    onMicButtonPress: jest.fn(),
    isMuted: false,
  };

  it('renders mute/unmute label based on isMuted and triggers callbacks', () => {
    const onMicButtonPress = jest.fn();
    const onSimulationEndPress = jest.fn();

    const {getByText, rerender} = render(
      <ControlButtons
        {...defaultProps}
        onMicButtonPress={onMicButtonPress}
        onSimulationEndPress={onSimulationEndPress}
        isMuted={false}
      />,
    );

    // When not muted
    getByText('SimulationAssistant.mute');

    // Press mic and stop
    fireEvent.press(getByText('SimulationAssistant.mute'));
    fireEvent.press(getByText('SimulationAssistant.endSession'));
    expect(onMicButtonPress).toHaveBeenCalled();
    expect(onSimulationEndPress).toHaveBeenCalled();

    // Rerender as muted
    rerender(
      <ControlButtons
        {...defaultProps}
        onMicButtonPress={onMicButtonPress}
        onSimulationEndPress={onSimulationEndPress}
        isMuted
      />,
    );
    getByText('SimulationAssistant.unmute');
  });

  it('respects disabled states', () => {
    const onMicButtonPress = jest.fn();
    const onSimulationEndPress = jest.fn();
    const {getByText} = render(
      <ControlButtons
        {...defaultProps}
        onMicButtonPress={onMicButtonPress}
        onSimulationEndPress={onSimulationEndPress}
        isMuted={false}
        isMicDisabled
        isSimulationEndDisabled
      />,
    );

    fireEvent.press(getByText('SimulationAssistant.mute'));
    fireEvent.press(getByText('SimulationAssistant.endSession'));
    expect(onMicButtonPress).not.toHaveBeenCalled();
    expect(onSimulationEndPress).not.toHaveBeenCalled();
  });
});


