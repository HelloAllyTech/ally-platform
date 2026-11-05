import React from 'react';
import {render, act} from '@testing-library/react-native';
import {Animated} from 'react-native';

import {SpeakingIndicator} from '../SpeakingIndicator';

describe('SpeakingIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders with correct structure', () => {
    const {UNSAFE_root} = render(<SpeakingIndicator isSpeaking={false} />);
    expect(UNSAFE_root).toBeDefined();
  });

  it('renders 3 animated bars', () => {
    const {UNSAFE_root} = render(<SpeakingIndicator isSpeaking={false} />);
    const animatedViews = UNSAFE_root.findAllByType(Animated.View);
    expect(animatedViews.length).toBeGreaterThanOrEqual(3);
  });

  it('starts animation when isSpeaking is true', () => {
    const parallelSpy = jest.spyOn(Animated, 'parallel');
    render(<SpeakingIndicator isSpeaking={true} />);
    expect(parallelSpy).toHaveBeenCalled();
  });

  it('handles transition from speaking to not speaking', () => {
    const {rerender} = render(<SpeakingIndicator isSpeaking={true} />);
    act(() => {
      rerender(<SpeakingIndicator isSpeaking={false} />);
      jest.advanceTimersByTime(500);
    });
  });

  it('handles transition from not speaking to speaking', () => {
    const {rerender} = render(<SpeakingIndicator isSpeaking={false} />);
    act(() => {
      rerender(<SpeakingIndicator isSpeaking={true} />);
      jest.advanceTimersByTime(500);
    });
  });
});

