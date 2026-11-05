import React from 'react';
import {act, render} from '@testing-library/react-native';

import {AudioWaveformContainer} from '../AudioWaveformContainer';

jest.useFakeTimers();

// Mock child component to capture props
const mockRender = jest.fn();
jest.mock('../../AudioWaveform/AudioWaveform', () => {
  const SILENT_AMPLITUDES = [0.08, 0.08, 0.08];
  return {
    SILENT_AMPLITUDES,
    shapeAmplitudes: (amplitudes: number[] | null) =>
      amplitudes?.length ? amplitudes : SILENT_AMPLITUDES,
    AudioWaveform: (props: any) => {
      mockRender(props);
      return null;
    },
  };
});

const {SILENT_AMPLITUDES} = jest.requireMock('../../AudioWaveform/AudioWaveform');

const lastProps = () => mockRender.mock.calls.at(-1)?.[0];

describe('AudioWaveformContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes frames from the ref into the shared value while recording', () => {
    const latestAmplitudesRef = {current: [0.1, 0.2, 0.3]} as React.
      MutableRefObject<number[] | null>;

    render(
      <AudioWaveformContainer
        latestAmplitudesRef={latestAmplitudesRef}
        isCallPaused={false}
        isFocusMode
      />,
    );

    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(lastProps().amplitudes.value).toEqual([0.1, 0.2, 0.3]);
    expect(lastProps().isFocusMode).toBe(true);
  });

  it('does not re-render the waveform as frames arrive', () => {
    const latestAmplitudesRef = {current: [0.1]} as React.MutableRefObject<
      number[] | null
    >;

    render(
      <AudioWaveformContainer
        latestAmplitudesRef={latestAmplitudesRef}
        isCallPaused={false}
        isFocusMode
      />,
    );

    const rendersAfterMount = mockRender.mock.calls.length;

    act(() => {
      latestAmplitudesRef.current = [0.9];
      jest.advanceTimersByTime(600); // five frames
    });

    expect(mockRender.mock.calls.length).toBe(rendersAfterMount);
    expect(lastProps().amplitudes.value).toEqual([0.9]);
  });

  it('rests the waveform and stops the timer while paused', () => {
    const latestAmplitudesRef = {current: [0.5]} as React.MutableRefObject<
      number[] | null
    >;

    render(
      <AudioWaveformContainer
        latestAmplitudesRef={latestAmplitudesRef}
        isCallPaused
        isFocusMode={false}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(lastProps().amplitudes.value).toBe(SILENT_AMPLITUDES);
    expect(lastProps().isFocusMode).toBe(false);
  });
});
