import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {ShinyText} from '@/components/ShinyText/ShinyText';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('@react-native-masked-view/masked-view', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children}: any) => React.createElement(View, null, children);
});

describe('ShinyText', () => {
  it('renders children text', () => {
    const {getByText} = render(<ShinyText>hello</ShinyText>);
    expect(getByText('hello')).toBeTruthy();
  });

  it('renders without animation when disabled', () => {
    const {getByText} = render(<ShinyText disabled>off</ShinyText>);
    expect(getByText('off')).toBeTruthy();
  });
});
