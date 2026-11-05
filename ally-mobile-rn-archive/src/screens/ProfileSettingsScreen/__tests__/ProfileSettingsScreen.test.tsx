import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {resolvedLanguage: 'en', language: 'en'},
  }),
}));

const mockGoBack = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({goBack: mockGoBack}),
  useTranslate: () => ({t: (key: string) => key}),
  useLanguageDropdown: () => ({
    selectedLanguage: 'English',
    setSelectedLanguage: jest.fn(),
    isLanguageDropdownOpen: false,
    setIsLanguageDropdownOpen: jest.fn(),
    languageOptions: ['English', 'Spanish'],
    languageMap: new Map([['English', 1], ['Spanish', 2]]),
  }),
  useProfileImage: () => ({
    previewImageUri: null,
    isSaving: false,
    hasUnsavedChanges: false,
    handleImagePicker: jest.fn(),
    handleRemoveImage: jest.fn(),
    handleSave: jest.fn(),
    resetToSavedState: jest.fn(),
  }),
  useUser: () => ({
    userData: {name: 'Maria Test', email: 'maria@test.com', profileImageUrl: null},
  }),
  useLeaderboardNotification: () => ({
    leaderboardNotifEnabled: false,
    handleLeaderboardNotifToggle: jest.fn(),
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
  ms: (v: number) => v,
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrowIcon: () => <View testID="back-arrow" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    Button: ({label, onPress}: any) => (
      <TouchableOpacity testID="save-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    CustomDropdown: ({value}: any) => (
      <View testID="language-dropdown">
        <Text>{value}</Text>
      </View>
    ),
    CustomModal: ({visible, title}: any) =>
      visible ? (
        <View testID="confirm-dialog">
          <Text>{title}</Text>
        </View>
      ) : null,
    CustomSwitch: () => <View testID="custom-switch" />,
    getLabelFromCode: (_code: string) => 'English',
    LanguageSelectorSheet: () => null,
  };
});

jest.mock('@/config/env', () => ({
  __esModule: true,
  env: {ENVIRONMENT: 'development', LANGUAGE_SELECTOR_FLAG: false},
}));


jest.mock('@/services', () => ({
  useUpdateUserPreferencesMutation: () => [jest.fn(), {isLoading: false}],
}));

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_t, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const p = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {__esModule: true, colors: p, fontFamily: p, fontWeights: p, typography: p, default: p};
});

jest.mock('../components/ProfileImageBottomSheet', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ProfileImageBottomSheet: () => <View testID="profile-image-bottom-sheet" />,
  };
});

import {ProfileSettingsScreen} from '../ProfileSettingsScreen';

describe('ProfileSettingsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders user name and email', () => {
    const {getByText} = render(<ProfileSettingsScreen />);

    expect(getByText('Maria Test')).toBeTruthy();
    expect(getByText('maria@test.com')).toBeTruthy();
  });

  it('renders profile and settings title', () => {
    const {getByText} = render(<ProfileSettingsScreen />);

    expect(
      getByText(/profile\.settings\.title/),
    ).toBeTruthy();
  });

  it('shows initial letter when no profile image', () => {
    const {getByText} = render(<ProfileSettingsScreen />);

    expect(getByText('M')).toBeTruthy();
  });

  it('renders upload image button when no image', () => {
    const {getByText} = render(<ProfileSettingsScreen />);

    expect(getByText('profile.settings.upload_image')).toBeTruthy();
  });

  it('navigates back on back button press when no unsaved changes', () => {
    const {getByTestId} = render(<ProfileSettingsScreen />);

    fireEvent.press(getByTestId('back-arrow').parent!);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('renders field labels', () => {
    const {getByText} = render(<ProfileSettingsScreen />);

    expect(getByText('profile.settings.name')).toBeTruthy();
    expect(getByText('profile.settings.email')).toBeTruthy();
  });
});
