import React from 'react';
import {ActivityIndicator, TouchableOpacity} from 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

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
        // Mirrors the real AudioParam closely enough for the rate tests: a
        // plain settable `value`.
        playbackRate: {value: 1},
        // Not on the real node — recorded here so tests can assert which mode
        // the node was constructed in.
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
}
);

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

import {SimulationAudioPlayer} from '../SimulationAudioPlayer';

describe('SimulationAudioPlayer', () => {
  const defaultProps = {
    audioUrl: 'https://example.com/audio.mp3',
    onProgress: jest.fn(),
  };

  /** Source nodes the component built, in construction order. */
  const sources = () => (global as any).__createdSources as any[];

  /**
   * Drains the mount-time fetch/decode chain inside act(...). The async form of
   * act is what flushes the promise ticks; a synchronous act(() => jest.runAllTimers())
   * only drains timers, so the decode would still resolve after the test body
   * returned and set state with nobody watching.
   */
  const settleLoad = async () => {
    await act(async () => {
      jest.runAllTimers();
    });
  };

    beforeEach(() => {

      jest.useFakeTimers();

      jest.clearAllMocks();

      (global as any).__createdSources = [];

      (global as any).fetch = jest.fn().mockResolvedValue({

        ok: true,

        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),

      });

    });

  

  afterEach(() => {
    delete (global as any).fetch;
    // The 200ms progress interval is still armed when a test ends mid-playback,
    // and draining it sets state — so this teardown needs act(...) just as much
    // as the tests do.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('shows loading indicator while audio is loading', async () => {
    const {UNSAFE_getByType} = render(<SimulationAudioPlayer {...defaultProps} />);
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    // The assertion above is the point of this test, so the mount-time load has
    // to stay unresolved until here — but it still has to settle inside act(...)
    // before the test returns, or its setState lands on an unmounted-in-spirit
    // tree during teardown.
    await settleLoad();
  });

  it('shows play button after audio loads', async () => {
    const {getByTestId} = render(<SimulationAudioPlayer {...defaultProps} />);
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());
  });

  it('toggles play/pause on press', async () => {
    const {getByTestId, queryByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    const playBtn = UNSAFE_getAllByType(TouchableOpacity)[0];
    fireEvent.press(playBtn);
    // Advance timers for progress updates (200ms interval)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(queryByTestId('pause-icon')).toBeTruthy();
  });

  it('renders time displays', async () => {
    const {getAllByText} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    const timeTexts = getAllByText('0:00');
    expect(timeTexts.length).toBe(2);
    await settleLoad();
  });

  it('defaults the speed control to 1x and cycles through the rates', async () => {
    const {getByText, getByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    const speedBtn = UNSAFE_getAllByType(TouchableOpacity)[1];
    expect(getByText('1x')).toBeTruthy();

    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(getByText('1.5x')).toBeTruthy();

    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(getByText('2x')).toBeTruthy();

    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(getByText('2.5x')).toBeTruthy();

    // wraps back around
    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(getByText('1x')).toBeTruthy();
  });

  it('persists the picked speed', async () => {
    const {setItem} = require('@/utils/asyncStorage');
    const {getByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    fireEvent.press(UNSAFE_getAllByType(TouchableOpacity)[1]);
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(setItem).toHaveBeenCalledWith('ally:audio:playback-rate', 1.5);
  });

  it('restores a persisted speed on mount', async () => {
    const {getItem} = require('@/utils/asyncStorage');
    getItem.mockResolvedValueOnce(2);

    const {getByText} = render(<SimulationAudioPlayer {...defaultProps} />);
    act(() => {
      jest.runAllTimers();
    });

    await waitFor(() => expect(getByText('2x')).toBeTruthy());
  });

  it('ignores a persisted speed that is not an offered rate', async () => {
    const {getItem} = require('@/utils/asyncStorage');
    getItem.mockResolvedValueOnce(1.75);

    const {getByText, getByTestId} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    expect(getByText('1x')).toBeTruthy();
  });

  it('retunes the live source node when the rate stays pitch-corrected', async () => {
    const {getByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    const [playBtn, speedBtn] = UNSAFE_getAllByType(TouchableOpacity);

    // 1x -> 1.5x while paused, so playback starts already pitch-corrected.
    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    fireEvent.press(playBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(sources()).toHaveLength(1);
    expect(sources()[0].pitchCorrection).toBe(true);
    expect(sources()[0].playbackRate.value).toBe(1.5);

    // 1.5x -> 2x keeps the same mode, so the node is retuned, not rebuilt.
    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(sources()).toHaveLength(1);
    expect(sources()[0].playbackRate.value).toBe(2);
  });

  it('rebuilds the source node when a rate change crosses the 1x boundary', async () => {
    const {getByTestId, UNSAFE_getAllByType} = render(
      <SimulationAudioPlayer {...defaultProps} />,
    );
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(getByTestId('play-icon')).toBeTruthy());

    const [playBtn, speedBtn] = UNSAFE_getAllByType(TouchableOpacity);

    fireEvent.press(playBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(sources()).toHaveLength(1);
    expect(sources()[0].pitchCorrection).toBe(false);

    // 1x -> 1.5x turns pitch correction on, which is fixed at construction.
    fireEvent.press(speedBtn);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(sources()).toHaveLength(2);
    expect(sources()[1].pitchCorrection).toBe(true);
    expect(sources()[1].playbackRate.value).toBe(1.5);
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
    act(() => {
      jest.runAllTimers();
    });
    await waitFor(() => expect(onPlaybackLoadError).toHaveBeenCalled());
  });
});
