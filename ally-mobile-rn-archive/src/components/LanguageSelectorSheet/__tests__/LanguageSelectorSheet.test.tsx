import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {LanguageSelectorSheet} from '../LanguageSelectorSheet';

const mockSheetProps: Record<string, unknown>[] = [];

jest.mock('@/components/BottomSheet', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BottomSheet: ({visible, children, ...rest}: any) => {
      mockSheetProps.push(rest);
      return visible
        ? React.createElement(View, {testID: 'bottom-sheet'}, children)
        : null;
    },
  };
});

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

const mockChangeLanguage = jest.fn();
jest.mock('@/localization/i18n', () => ({
  __esModule: true,
  default: {
    resolvedLanguage: 'en',
    language: 'en',
    changeLanguage: (code: string) => mockChangeLanguage(code),
  },
}));

jest.mock('@/services/api', () => ({
  api: {util: {resetApiState: () => ({type: 'api/resetApiState'})}},
}));

jest.mock('@/store/store', () => ({store: {dispatch: jest.fn()}}));

describe('LanguageSelectorSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSheetProps.length = 0;
  });

  it('renders every language as its own tappable row', () => {
    const {getByTestId} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    ['en', 'hi', 'mr', 'ta', 'kn'].forEach(code => {
      expect(getByTestId(`language-option-${code}`)).toBeTruthy();
    });
  });

  // The rows used to live in a bare FlatList, which reports no height of its own. A
  // sheet sized from its content therefore had no snap points to open to, and the
  // picker read as an unresponsive control. Keep the height declared, not measured.
  it('declares a fixed height instead of sizing itself to its content', () => {
    render(<LanguageSelectorSheet visible onClose={jest.fn()} />);

    expect(mockSheetProps[0]).toMatchObject({
      enableDynamicSizing: false,
      initialSnapPoint: 45,
    });
  });

  it('switches language on select', () => {
    const {getByTestId} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    fireEvent.press(getByTestId('language-option-ta'));

    expect(mockChangeLanguage).toHaveBeenCalledWith('ta');
  });

  it('marks the active language as selected', () => {
    const {getByTestId} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    expect(
      getByTestId('language-option-en').props.accessibilityState,
    ).toMatchObject({selected: true});
    expect(
      getByTestId('language-option-hi').props.accessibilityState,
    ).toMatchObject({selected: false});
  });

  it('renders nothing while hidden', () => {
    const {queryByTestId} = render(
      <LanguageSelectorSheet visible={false} onClose={jest.fn()} />,
    );

    expect(queryByTestId('bottom-sheet')).toBeNull();
  });
});
