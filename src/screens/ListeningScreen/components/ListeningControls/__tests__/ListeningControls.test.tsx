import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CloseIcon: () => <View testID="close-icon" />,
    MicIcon: () => <View testID="mic-icon" />,
    PauseIcon: () => <View testID="pause-icon" />,
    ResumeIcon: () => <View testID="resume-icon" />,
    ShieldIcon: () => <View testID="shield-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    CollapsibleButtonGroup: ({
      buttons,
      children,
      headerContent,
      testID,
    }: any) => (
      <View testID={testID}>
        {headerContent}
        {buttons.map((btn: any) => (
          <TouchableOpacity
            key={btn.id}
            testID={`btn-${btn.id}`}
            onPress={btn.onPress}
            disabled={btn.disabled}>
            <Text>{btn.label}</Text>
          </TouchableOpacity>
        ))}
        {children}
      </View>
    ),
  };
});

jest.mock('@/constants', () => ({DEFAULT_HIT_SLOP: {top: 8, bottom: 8, left: 8, right: 8}}));

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    black: '#000',
    lightGrayD9: '#d9d9d9',
    darkGray3: '#333',
    coralRed: '#f00',
    ds: {typography: {highEmphasis: '#111'}},
  },
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}, MEDIUM: {}}},
}));

import {ListeningControls} from '../ListeningControls';

describe('ListeningControls', () => {
  const defaultProps = {
    isMaximized: false,
    onToggleMaximized: jest.fn(),
    isFocusMode: false,
    onFocusModeButtonPress: jest.fn(),
    isCallPaused: false,
    onPauseResumePress: jest.fn(),
    onCallEndPress: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders pause/resume and end session buttons by default', () => {
    const {getByTestId, getByText} = render(
      <ListeningControls {...defaultProps} />,
    );

    expect(getByTestId('btn-pause-resume')).toBeTruthy();
    expect(getByTestId('btn-end')).toBeTruthy();
    expect(getByText('listeningScreen.endSession')).toBeTruthy();
  });

  it('shows resume label when call is paused', () => {
    const {getByText} = render(
      <ListeningControls {...defaultProps} isCallPaused={true} />,
    );

    expect(getByText('listeningScreen.resumeTranscription')).toBeTruthy();
  });

  it('shows pause label when call is active', () => {
    const {getByText} = render(
      <ListeningControls {...defaultProps} isCallPaused={false} />,
    );

    expect(getByText('listeningScreen.pauseTranscription')).toBeTruthy();
  });

  it('renders focus mode button when showFocusModeButton is true', () => {
    const {getByTestId} = render(
      <ListeningControls {...defaultProps} showFocusModeButton={true} />,
    );

    expect(getByTestId('btn-focus')).toBeTruthy();
  });

  it('does not render focus mode button by default', () => {
    const {queryByTestId} = render(
      <ListeningControls {...defaultProps} />,
    );

    expect(queryByTestId('btn-focus')).toBeNull();
  });

  it('shows data safety text', () => {
    const {getByText} = render(
      <ListeningControls {...defaultProps} />,
    );

    expect(getByText('listeningScreen.dataSafe')).toBeTruthy();
  });

  it('shows mute tooltip when showMuteTooltip is true', () => {
    const {getByText} = render(
      <ListeningControls {...defaultProps} showMuteTooltip={true} />,
    );

    expect(getByText('listeningScreen.muteTooltip')).toBeTruthy();
  });

  it('does not show mute tooltip by default', () => {
    const {queryByText} = render(
      <ListeningControls {...defaultProps} />,
    );

    expect(queryByText('listeningScreen.muteTooltip')).toBeNull();
  });
});
