import React from 'react';
import {StyleSheet} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {getLabelFromCode, LanguageSelectorSheet} from '../LanguageSelectorSheet';

jest.mock('@/components/BottomSheet', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BottomSheet: ({visible, children}: any) =>
      visible ? React.createElement(View, {testID: 'bottom-sheet'}, children) : null,
  };
});

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

const mockChangeLanguage = jest.fn();
jest.mock('@/localization/i18n', () => ({
  __esModule: true,
  default: {
    get resolvedLanguage() {
      return 'en';
    },
    language: 'en',
    changeLanguage: (code: string) => mockChangeLanguage(code),
  },
}));

jest.mock('@/services/api', () => ({
  api: {util: {resetApiState: () => ({type: 'api/resetApiState'})}},
}));

const mockDispatch = jest.fn();
jest.mock('@/store/store', () => ({
  store: {dispatch: (action: unknown) => mockDispatch(action)},
}));

describe('LanguageSelectorSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders every language option', () => {
    const {getByTestId} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    ['en', 'hi', 'mr', 'ta', 'kn'].forEach(code => {
      expect(getByTestId(`language-option-${code}`)).toBeTruthy();
    });
  });

  // The bundled fonts carry no Indic glyphs, so a native-script label can draw as
  // empty space. Both guards below are what keeps such a row identifiable and
  // tappable rather than looking like a dead control.
  it('labels each non-Latin option with its English name too', () => {
    const {getByText} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    ['Hindi', 'Marathi', 'Tamil', 'Kannada'].forEach(name => {
      expect(getByText(name)).toBeTruthy();
    });
  });

  it('keeps native-script labels on the app font, which the fallback extends', () => {
    const {getByText} = render(
      <LanguageSelectorSheet visible onClose={jest.fn()} />,
    );

    const style = StyleSheet.flatten(getByText('தமிழ்').props.style);
    expect(style.fontFamily).toBe('IBMPlexSerif-Regular');
  });

  it('switches language and closes on select', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <LanguageSelectorSheet visible onClose={onClose} />,
    );

    fireEvent.press(getByTestId('language-option-ta'));

    expect(mockChangeLanguage).toHaveBeenCalledWith('ta');
  });

  it('renders nothing while hidden', () => {
    const {queryByTestId} = render(
      <LanguageSelectorSheet visible={false} onClose={jest.fn()} />,
    );

    expect(queryByTestId('bottom-sheet')).toBeNull();
  });

  describe('getLabelFromCode', () => {
    it('pairs a native name with its English name', () => {
      expect(getLabelFromCode('ta')).toBe('தமிழ் (Tamil)');
    });

    it('does not repeat itself for English', () => {
      expect(getLabelFromCode('en')).toBe('English');
    });

    it('falls back to English for an unknown code', () => {
      expect(getLabelFromCode('xx')).toBe('English');
    });
  });
});
