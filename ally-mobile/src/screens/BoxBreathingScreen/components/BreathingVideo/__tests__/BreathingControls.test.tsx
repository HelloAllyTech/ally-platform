import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {BreathingControls} from '../BreathingControls';

// Mock icons
jest.mock('@/assets/icons', () => ({
  PauseWhiteIcon: () => 'PauseWhiteIcon',
  PlayWhiteIcon: () => 'PlayWhiteIcon',
  VolumeIcon: () => 'VolumeIcon',
  VolumeOffIcon: () => 'VolumeOffIcon',
}));

describe('BreathingControls', () => {
  const defaultProps = {
    isMuted: false,
    isPlaying: false,
    onToggleMute: jest.fn(),
    onTogglePlayPause: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    const {getByTestId} = render(
      <BreathingControls {...defaultProps} testID="breathing-controls" />,
    );
    expect(getByTestId('volume-button')).toBeTruthy();
    expect(getByTestId('play-pause-button')).toBeTruthy();
  });

  it('shows correct volume icon based on mute state', () => {
    const {getByTestId, rerender} = render(
      <BreathingControls {...defaultProps} testID="breathing-controls" />,
    );

    // When not muted
    const volumeButton = getByTestId('volume-button');
    expect(volumeButton).toHaveTextContent('VolumeIcon');

    // When muted
    rerender(
      <BreathingControls
        {...defaultProps}
        isMuted={true}
        testID="breathing-controls"
      />,
    );
    expect(volumeButton).toHaveTextContent('VolumeOffIcon');
  });

  it('shows correct play/pause icon based on playing state', () => {
    const {getByTestId, rerender} = render(
      <BreathingControls {...defaultProps} testID="breathing-controls" />,
    );

    // When not playing
    const playPauseButton = getByTestId('play-pause-button');
    expect(playPauseButton).toHaveTextContent('PlayWhiteIcon');

    // When playing
    rerender(
      <BreathingControls
        {...defaultProps}
        isPlaying={true}
        testID="breathing-controls"
      />,
    );
    expect(playPauseButton).toHaveTextContent('PauseWhiteIcon');
  });

  it('calls onToggleMute when volume button is pressed', () => {
    const onToggleMute = jest.fn();
    const {getByTestId} = render(
      <BreathingControls
        {...defaultProps}
        onToggleMute={onToggleMute}
        testID="breathing-controls"
      />,
    );

    fireEvent.press(getByTestId('volume-button'));
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('calls onTogglePlayPause when play/pause button is pressed', () => {
    const onTogglePlayPause = jest.fn();
    const {getByTestId} = render(
      <BreathingControls
        {...defaultProps}
        onTogglePlayPause={onTogglePlayPause}
        testID="breathing-controls"
      />,
    );

    fireEvent.press(getByTestId('play-pause-button'));
    expect(onTogglePlayPause).toHaveBeenCalledTimes(1);
  });
});
