import React from 'react';
import {act, render, waitFor} from '@testing-library/react-native';

import {CallEndOverlay} from '../CallEndOverlay';

// Mock LinearGradient
jest.mock('react-native-linear-gradient', () => 'LinearGradient');

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  // Mock withTiming function
  const withTiming = (toValue: number, config: any, cb?: any) => {
    'worklet';
    if (cb) {
      cb(true);
    }
    return toValue;
  };
  return {
    ...Reanimated,
    withTiming,
  };
});

// Mock useTranslate hook
jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

describe('CallEndOverlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders initial message correctly', () => {
    const {getByText} = render(<CallEndOverlay />);

    expect(getByText(/stressBuster.messages.gaveBest/)).toBeTruthy();
  });

  it('transitions to second message after delay', async () => {
    const {getByText, queryByText} = render(<CallEndOverlay />);

    // Initial message is visible
    expect(getByText(/stressBuster.messages.gaveBest/)).toBeTruthy();

    // Advance timers to trigger message change
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      // Initial message should be gone
      expect(queryByText(/stressBuster.messages.gaveBest/)).toBeNull();
      // Second message should be visible
      expect(
        getByText(/stressBuster.messages.momentForYourself/),
      ).toBeTruthy();
    });
  });

  it('handles animation timing correctly', () => {
    const {getByTestId} = render(<CallEndOverlay />);
    const animatedView = getByTestId('animated-message');

    // Initial opacity should be 1
    expect(animatedView.props.style).toContainEqual({opacity: 1});

    // After 1 second, opacity should start fading out
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // After fade out and message change, opacity should return to 1
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(animatedView.props.style).toContainEqual({opacity: 1});
  });

  it('cleans up timers on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const {unmount} = render(<CallEndOverlay />);

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
