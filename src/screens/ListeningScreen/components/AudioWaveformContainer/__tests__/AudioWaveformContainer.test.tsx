import React from 'react';
import {render, act} from '@testing-library/react-native';

import {AudioWaveformContainer} from '../AudioWaveformContainer';

jest.useFakeTimers();

// Mock child component to capture props
const mockRender = jest.fn();
jest.mock('../../AudioWaveform/AudioWaveform', () => ({
  AudioWaveform: (props: any) => {
    mockRender(props);
    return null;
  },
}));

describe('AudioWaveformContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates amplitudes from ref at intervals when not paused', () => {
    const latestAmplitudesRef = {current: [0.1, 0.2, 0.3]} as React.MutableRefObject<number[] | null>;

    render(
      <AudioWaveformContainer
        latestAmplitudesRef={latestAmplitudesRef}
        isCallPaused={false}
        isFocusMode={true}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(150);
    });

    // Last call should have amplitudes from ref
    const lastCall = mockRender.mock.calls.at(-1)?.[0];
    expect(lastCall.amplitudes).toEqual([0.1, 0.2, 0.3]);
    expect(lastCall.isFocusMode).toBe(true);
  });

  it('sends null amplitudes when paused', () => {
    const latestAmplitudesRef = {current: [0.5]} as React.MutableRefObject<number[] | null>;

    render(
      <AudioWaveformContainer
        latestAmplitudesRef={latestAmplitudesRef}
        isCallPaused={true}
        isFocusMode={false}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(150);
    });

    const lastCall = mockRender.mock.calls.at(-1)?.[0];
    expect(lastCall.amplitudes).toBeNull();
    expect(lastCall.isFocusMode).toBe(false);
  });
});


