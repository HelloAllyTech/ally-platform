import React from 'react';
import {ActivityIndicator, TouchableOpacity, Text} from 'react-native';
import {fireEvent, render, waitFor, act} from '@testing-library/react-native';
import {SimulationAudioPlayer} from '../SimulationAudioPlayer';

// Mock audio context and other modules similar to SimulationAudioPlayer.test.tsx
jest.mock('react-native-audio-api', () => {
  class MockAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    destination = {};
    createBufferSource(options?: {pitchCorrection?: boolean}) {
      const src = {
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onEnded: null as any,
        buffer: null as any,
        playbackRate: {value: 1},
        pitchCorrection: options?.pitchCorrection ?? false,
      };
      ((global as any).__createdSources ??= []).push(src);
      return src;
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
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}, MEDIUM: {}}},
}));

jest.mock('@/utils/asyncStorage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
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

describe('SimulationAudioPlayer regression', () => {
  const defaultProps = {
    audioUrl: 'https://example.com/audio.mp3',
    onProgress: jest.fn(),
  };

  /** Source nodes the component built, in construction order. */
  const sources = () => (global as any).__createdSources as any[];

  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).__createdSources = [];
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (global as any).fetch;
    consoleErrorSpy.mockRestore();
  });

  it('should log an act warning when state updates are not wrapped', async () => {
    const {getByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );

    // Wait for the player to load and show the play button
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    // Press the play button
    const playBtn = UNSAFE_getAllByType(TouchableOpacity)[0];
    fireEvent.press(playBtn);

    // Simulate audio ending without `act`
    // This state update within the component should trigger the act warning.
    await waitFor(() => {
        expect(sources()).toHaveLength(1);
        expect(sources()[0].onEnded).not.toBeNull();
    });

    // Manually trigger onEnded, now wrapped in `act` to resolve the warning.
    act(() => {
        sources()[0].onEnded();
    });

    // The warning should no longer be called after wrapping in act.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('An update to SimulationAudioPlayer inside a test was not wrapped in act(...)'),
    );
  });
});
