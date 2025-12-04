import React from 'react';
import {render} from '@testing-library/react-native';
import {Animated} from 'react-native';

import {SpeakingIndicator} from '../SpeakingIndicator';

describe('SpeakingIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with correct structure', () => {
    const {UNSAFE_root} = render(<SpeakingIndicator isSpeaking={false} />);
    
    // Should render without crashing
    expect(UNSAFE_root).toBeDefined();
  });

  it('renders 3 animated bars', () => {
    const {UNSAFE_root} = render(<SpeakingIndicator isSpeaking={false} />);
    
    // Should have 3 animated bars
    const animatedViews = UNSAFE_root.findAllByType(Animated.View);
    expect(animatedViews.length).toBeGreaterThanOrEqual(3);
  });

  it('starts animation when isSpeaking is true', () => {
    const parallelSpy = jest.spyOn(Animated, 'parallel');
    
    render(<SpeakingIndicator isSpeaking={true} />);
    
    // Animated.parallel should be called to start the animations
    expect(parallelSpy).toHaveBeenCalled();
  });

  it('handles transition from speaking to not speaking', () => {
    const {rerender} = render(<SpeakingIndicator isSpeaking={true} />);
    
    // Change to not speaking - should not throw
    expect(() => {
      rerender(<SpeakingIndicator isSpeaking={false} />);
    }).not.toThrow();
  });

  it('handles transition from not speaking to speaking', () => {
    const {rerender} = render(<SpeakingIndicator isSpeaking={false} />);
    
    // Change to speaking - should not throw
    expect(() => {
      rerender(<SpeakingIndicator isSpeaking={true} />);
    }).not.toThrow();
  });
});

