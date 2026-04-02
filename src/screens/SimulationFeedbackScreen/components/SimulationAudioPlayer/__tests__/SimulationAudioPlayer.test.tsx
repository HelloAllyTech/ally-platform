import React from 'react';
import {ActivityIndicator, TouchableOpacity} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

jest.mock('react-native-audio-api', () => {
  class MockAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    destination = {};
    createBufferSource() {
      return {
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onEnded: null as any,
        buffer: null as any,
      };
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  return {
    AudioContext: MockAudioContext,
    AudioManager: {
      getDevicePreferredSampleRate: jest.fn().mockReturnValue(44100),
      setAudioSessionActivity: jest.fn().mockResolvedValue(undefined),
    },
    decodeAudioData: jest.fn().mockResolvedValue({
      duration: 10,
      length: 441000,
      numberOfChannels: 1,
      sampleRate: 44100,
    }),
  };
});

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    PausePlayerIcon: (props: any) => <View testID="pause-icon" {...props} />,
    PlayWhiteIcon: (props: any) => <View testID="play-icon" {...props} />,
  };
});

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    ds: {
      neutral: {400: '#999'},
      theme: {primary: '#007'},
      grey: {200: '#ddd'},
      blue: {50: '#f0f8ff', 100: '#e0f0ff'},
      typography: {mediumEmphasis: '#666', lowEmphasis: '#aaa'},
      stroke: {primary: '#ccc'},
    },
  },
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}}},
}));

jest.mock('@/utils', () => ({
  formatTimeToMMSS: (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {error: jest.fn(), warn: jest.fn(), info: jest.fn()},
}));

import {SimulationAudioPlayer} from '../SimulationAudioPlayer';

describe('SimulationAudioPlayer', () => {
  const defaultProps = {
    audioUrl: 'https://example.com/audio.mp3',
    onProgress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('shows loading indicator while audio is loading', () => {
    const {UNSAFE_getByType} = render(<SimulationAudioPlayer {...defaultProps} />);
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('shows play button after audio loads', async () => {
    const {getByTestId} = render(<SimulationAudioPlayer {...defaultProps} />);
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());
  });

  it('toggles play/pause on press', async () => {
    const {getByTestId, queryByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );

    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    const playBtn = UNSAFE_getAllByType(TouchableOpacity)[0];
    fireEvent.press(playBtn);

    expect(queryByTestId('pause-icon')).toBeTruthy();
  });

  it('renders time displays', () => {
    const {getAllByText} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    const timeTexts = getAllByText('0:00');
    expect(timeTexts.length).toBe(2);
  });

  it('calls onPlaybackLoadError when audio fails to load', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    });
    const onPlaybackLoadError = jest.fn();
    render(
      <SimulationAudioPlayer
        {...defaultProps}
        onPlaybackLoadError={onPlaybackLoadError}
      />,
    );
    await waitFor(() => expect(onPlaybackLoadError).toHaveBeenCalled());
  });
});
