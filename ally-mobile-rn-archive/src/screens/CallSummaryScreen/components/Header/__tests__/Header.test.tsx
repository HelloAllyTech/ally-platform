import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {Header} from '../Header';

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrowIcon: () => <View testID="left-arrow-icon" />,
    ThreeDotsIcon: () => <View testID="three-dots-icon" />,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Switch} = require('react-native');
  return {
    CustomSwitch: ({value, onToggle}: any) => (
      <Switch testID="custom-switch" value={value} onChange={() => onToggle(!value)} />
    ),
  };
});

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/constants/general', () => ({
  DEFAULT_HIT_SLOP: {top: 10, bottom: 10, left: 10, right: 10},
  isIOS: false,
}));

jest.mock('@/theme', () => ({
  colors: {
    black: '#000',
    white: '#fff',
    ds: {typography: {highEmphasis: '#111', mediumEmphasis: '#666', lowEmphasis: '#999'}},
  },
  fontFamily: {
    REPLAY_PRO: {HEADLINE: {}, BOLD_ITALIC: {}},
    IBM_PLEX_SERIF: {REGULAR: {}, MEDIUM: {}},
  },
  typography: {headline: {tiny: {}}, body: {medium: {}, small: {}}},
}));

const baseProps = {
  onBackPress: jest.fn(),
  onMenuPress: jest.fn(),
};

describe('Header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and subtitle', () => {
    const {getByText} = render(<Header {...baseProps} />);
    expect(getByText(/callSummary\.header\.title/)).toBeTruthy();
    expect(getByText(/callSummary\.header\.subtitle/)).toBeTruthy();
  });

  it('renders summary name with # prefix', () => {
    const {getByText} = render(<Header {...baseProps} summaryName="Test Session" />);
    expect(getByText('#Test Session')).toBeTruthy();
  });

  it('renders dash when summary name is empty', () => {
    const {getByText} = render(<Header {...baseProps} summaryName="" />);
    expect(getByText('-')).toBeTruthy();
  });

  it('calls onBackPress when back button is pressed', () => {
    const {getByTestId} = render(<Header {...baseProps} />);
    const backIcon = getByTestId('left-arrow-icon');
    fireEvent.press(backIcon.parent!);
    expect(baseProps.onBackPress).toHaveBeenCalled();
  });

  it('calls onMenuPress when menu button is pressed', () => {
    const {getByTestId} = render(<Header {...baseProps} />);
    const menuIcon = getByTestId('three-dots-icon');
    fireEvent.press(menuIcon.parent!);
    expect(baseProps.onMenuPress).toHaveBeenCalled();
  });

  it('shows share switch when showShareSwitch is true', () => {
    const onShareToggle = jest.fn();
    const {getByTestId, getByText} = render(
      <Header
        {...baseProps}
        showShareSwitch={true}
        isSharedForReview={false}
        onShareToggle={onShareToggle}
      />,
    );

    expect(getByText('learn.scenario.share')).toBeTruthy();
    expect(getByTestId('custom-switch')).toBeTruthy();
  });

  it('does not show share switch when showShareSwitch is false', () => {
    const {queryByTestId} = render(<Header {...baseProps} showShareSwitch={false} />);
    expect(queryByTestId('custom-switch')).toBeNull();
  });

  it('does not show share switch when onShareToggle is not provided', () => {
    const {queryByTestId} = render(
      <Header {...baseProps} showShareSwitch={true} />,
    );
    expect(queryByTestId('custom-switch')).toBeNull();
  });
});
