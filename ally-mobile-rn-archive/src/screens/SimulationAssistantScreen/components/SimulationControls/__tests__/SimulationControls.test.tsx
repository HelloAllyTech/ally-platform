import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationControls} from '../SimulationControls';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    MicIcon: ({color}: any) => <View testID="mic-icon" />,
    MicOffIcon: () => <View testID="mic-off-icon" />,
    MicOnIcon: () => <View testID="mic-on-icon" />,
  };
});

jest.mock('@/theme', () => ({
  colors: {black: '#000', white: '#fff'},
}));

const mockCollapsibleButtonGroup = jest.fn();
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    CollapsibleButtonGroup: (props: any) => {
      mockCollapsibleButtonGroup(props);
      return (
        <View testID="collapsible-button-group">
          {props.buttons.map((btn: any) => (
            <View key={btn.id} testID={`button-${btn.id}`}>
              <Text>{btn.label}</Text>
            </View>
          ))}
        </View>
      );
    },
  };
});

jest.mock('../../../styles', () => ({
  styles: {endButtonIcon: {}},
}));

const defaultProps = {
  isMaximized: false,
  onToggleMaximized: jest.fn(),
  isMicEnabled: true,
  onMicToggle: jest.fn(),
  isFocusMode: false,
  onFocusModeToggle: jest.fn(),
  onEndSession: jest.fn(),
  isSimulationInProgress: true,
};

describe('SimulationControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders three control buttons (mic, focus, end)', () => {
    const {getByTestId} = render(<SimulationControls {...defaultProps} />);

    expect(getByTestId('button-mic')).toBeTruthy();
    expect(getByTestId('button-focus')).toBeTruthy();
    expect(getByTestId('button-end')).toBeTruthy();
  });

  it('passes isMaximized and onToggleMaximized to CollapsibleButtonGroup', () => {
    render(<SimulationControls {...defaultProps} isMaximized={true} />);

    expect(mockCollapsibleButtonGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        isMaximized: true,
        testID: 'simulation-control-buttons',
      }),
    );
  });

  it('shows mute label when mic is enabled', () => {
    const {getByText} = render(
      <SimulationControls {...defaultProps} isMicEnabled={true} />,
    );
    expect(getByText('simulationPage.mute')).toBeTruthy();
  });

  it('shows unmute label when mic is disabled', () => {
    const {getByText} = render(
      <SimulationControls {...defaultProps} isMicEnabled={false} />,
    );
    expect(getByText('simulationPage.unmute')).toBeTruthy();
  });

  it('shows focused label when focus mode is active', () => {
    const {getByText} = render(
      <SimulationControls {...defaultProps} isFocusMode={true} />,
    );
    expect(getByText('listeningScreen.focused')).toBeTruthy();
  });

  it('shows focus label when focus mode is inactive', () => {
    const {getByText} = render(
      <SimulationControls {...defaultProps} isFocusMode={false} />,
    );
    expect(getByText('listeningScreen.focus')).toBeTruthy();
  });

  it('disables buttons when simulation is not in progress', () => {
    render(
      <SimulationControls {...defaultProps} isSimulationInProgress={false} />,
    );

    const buttons = mockCollapsibleButtonGroup.mock.calls[0][0].buttons;
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[2].disabled).toBe(true);
  });

  it('mic button has active variant when mic is disabled', () => {
    render(
      <SimulationControls {...defaultProps} isMicEnabled={false} />,
    );

    const buttons = mockCollapsibleButtonGroup.mock.calls[0][0].buttons;
    expect(buttons[0].variant).toBe('active');
  });

  it('end button has destructive variant', () => {
    render(<SimulationControls {...defaultProps} />);

    const buttons = mockCollapsibleButtonGroup.mock.calls[0][0].buttons;
    expect(buttons[2].variant).toBe('destructive');
  });
});
