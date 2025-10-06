import React from 'react';
import {render} from '@testing-library/react-native';

import {ListeningAnimation} from '../ListeningAnimation';

// Mock react-native-svg which is used internally by ListeningAnimation
jest.mock('react-native-svg', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: View,
    Svg: View,
    Defs: View,
    LinearGradient: View,
    Path: View,
    Rect: View,
    Stop: View,
  };
});

describe('ListeningAnimation', () => {
  it('renders waves with default props', () => {
    const {toJSON} = render(<ListeningAnimation />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom maxAmplitude and not animating', () => {
    const {toJSON} = render(
      <ListeningAnimation isAnimating={false} maxAmplitude={200} />,
    );
    expect(toJSON()).not.toBeNull();
  });
});


