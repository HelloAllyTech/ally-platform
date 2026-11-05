import React from 'react';
import {render} from '@testing-library/react-native';

// Mock LottieView
jest.mock('lottie-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  return React.forwardRef((props: any, ref: any) =>
    React.createElement(View, {...props, ref}),
  );
});

// Mock ShinyText
jest.mock('@/components', () => ({
  ShinyText: ({children, style}: any) => {
    const React = require('react');
    const {Text} = require('react-native');
    return React.createElement(Text, {style}, children);
  },
}));

// Mock hooks
jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

import {SimulationSummarySkeleton} from '../SimulationSummarySkeleton';

describe('SimulationSummarySkeleton', () => {
  it('renders when isLoading', () => {
    const {toJSON} = render(<SimulationSummarySkeleton isLoading />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders null when not loading', () => {
    const {toJSON} = render(<SimulationSummarySkeleton isLoading={false} />);
    expect(toJSON()).toBeNull();
  });
});


