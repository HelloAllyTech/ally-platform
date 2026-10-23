import React from 'react';
import {render} from '@testing-library/react-native';

import {ShortSessionUI} from '../ShortSessionUI';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    HourGlassIcon: (props: any) =>
      React.createElement(View, {...props, testID: 'hourglass-icon'}),
  };
});

describe('ShortSessionUI', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<ShortSessionUI />);
    expect(toJSON()).toBeTruthy();
  });

  it('displays title and description text', () => {
    const {getByText} = render(<ShortSessionUI />);

    expect(getByText('postSim.shortSession.title')).toBeTruthy();
    expect(
      getByText('postSim.shortSession.description'),
    ).toBeTruthy();
  });

  it('renders hourglass icon', () => {
    const {getByTestId} = render(<ShortSessionUI />);

    expect(getByTestId('hourglass-icon')).toBeTruthy();
  });
});
