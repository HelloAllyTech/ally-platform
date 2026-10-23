import React from 'react';
import {render} from '@testing-library/react-native';

import {FlowerPetal} from '../FlowerPetal';

// Provide a local svg mock with expected named components for this test
jest.mock('react-native-svg', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => React.createElement('svg', props),
    Defs: (props: any) => React.createElement('defs', props),
    Path: (props: any) => React.createElement('path', props),
    RadialGradient: (props: any) => React.createElement('radialGradient', props),
    Stop: (props: any) => React.createElement('stop', props),
  };
});

// Reanimated and SVG are mocked by Jest setup / transformers; this is a render smoke test
describe('FlowerPetal', () => {
  it('renders petals and stem without crashing', () => {
    const bloomProgress = {value: 0.5};
    const {UNSAFE_getAllByType} = render(
      <FlowerPetal bloomProgress={bloomProgress} size={200} />,
    );

    // Five petals are rendered via AnimatedPath and one stem Path
    // We assert at least the SVG structure renders by counting any Path-like elements
    const paths = UNSAFE_getAllByType(require('react-native-svg').Path);
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });
});


