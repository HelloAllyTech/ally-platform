import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    MicOffWhiteIcon: () => <View testID="mic-off-icon" />,
    UserIcon: () => <View testID="user-icon" />,
  };
});

jest.mock('@/constants', () => ({AUDIO: {THRESHOLD: 0.1}}));

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    ds: {
      whiteAlpha: {50: 'rgba(255,255,255,0.05)'},
      theme: {primaryLight: '#aaf'},
      blackAlpha: {800: 'rgba(0,0,0,0.8)'},
    },
  },
  fontFamily: {ROBOTO: {REGULAR: {}}},
}));

const mockAudioLevel = jest.fn(() => 0);
jest.mock('../../AudioWave/useAudioLevel', () => ({
  useAudioLevel: () => mockAudioLevel(),
}));

jest.mock('../../SpeakingIndicator', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SpeakingIndicator: ({isSpeaking}: {isSpeaking: boolean}) => (
      <View testID={`speaking-indicator-${isSpeaking}`} />
    ),
  };
});

jest.mock('livekit-client', () => ({
  Track: {Source: {Microphone: 'microphone'}},
}));

import {ParticipantTile} from '../ParticipantTile';

describe('ParticipantTile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudioLevel.mockReturnValue(0);
  });

  it('renders placeholder icon when no avatarUrl', () => {
    const {getByTestId} = render(<ParticipantTile />);
    expect(getByTestId('user-icon')).toBeTruthy();
  });

  it('renders avatar image when avatarUrl is provided', () => {
    const {UNSAFE_root} = render(
      <ParticipantTile avatarUrl="https://example.com/avatar.png" />,
    );
    const img = UNSAFE_root.findAll(
      node => node.props?.source?.uri === 'https://example.com/avatar.png',
    );
    expect(img.length).toBeGreaterThan(0);
  });

  it('renders name when provided', () => {
    const {getByText} = render(<ParticipantTile name="Alice" />);
    expect(getByText('Alice')).toBeTruthy();
  });

  it('does not render speaker overlay when name is absent', () => {
    const {queryByText} = render(<ParticipantTile />);
    expect(queryByText(/.+/)).toBeNull();
  });

  it('shows speaking indicator when mic is enabled', () => {
    const {getByTestId} = render(
      <ParticipantTile name="Alice" isMicEnabled={true} />,
    );
    expect(getByTestId('speaking-indicator-false')).toBeTruthy();
  });

  it('shows mic-off icon when mic is disabled', () => {
    const {getByTestId} = render(
      <ParticipantTile name="Alice" isMicEnabled={false} />,
    );
    expect(getByTestId('mic-off-icon')).toBeTruthy();
  });

  it('renders topLeftOverlay when provided', () => {
    const React = require('react');
    const {View} = require('react-native');
    const {getByTestId} = render(
      <ParticipantTile topLeftOverlay={<View testID="custom-overlay" />} />,
    );
    expect(getByTestId('custom-overlay')).toBeTruthy();
  });

  it('calls overlayRef.close on press if overlay is open', () => {
    const closeFn = jest.fn();
    const overlayRef = {current: {isOpen: true, close: closeFn}} as any;

    const {getByText} = render(
      <ParticipantTile name="Alice" overlayRef={overlayRef} />,
    );
    fireEvent.press(getByText('Alice'));
    expect(closeFn).toHaveBeenCalled();
  });
});
