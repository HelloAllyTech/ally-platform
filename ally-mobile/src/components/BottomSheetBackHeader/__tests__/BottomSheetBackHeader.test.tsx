import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {BottomSheetBackHeader} from '../BottomSheetBackHeader';

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrow: (props: object) =>
      React.createElement(View, {...props, testID: 'back-button'}),
  };
});

describe('BottomSheetBackHeader', () => {
  const onBack = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title', () => {
    const {getByText} = render(
      <BottomSheetBackHeader title="My Title" onBack={onBack} />,
    );

    expect(getByText('My Title')).toBeTruthy();
  });

  it('calls onBack when back button pressed', () => {
    const {getByTestId} = render(
      <BottomSheetBackHeader title="My Title" onBack={onBack} />,
    );

    fireEvent.press(getByTestId('back-button'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders without crashing', () => {
    const {toJSON} = render(
      <BottomSheetBackHeader title="Test" onBack={onBack} />,
    );

    expect(toJSON()).toBeTruthy();
  });
});
