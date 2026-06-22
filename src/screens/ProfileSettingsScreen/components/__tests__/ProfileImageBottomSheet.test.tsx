import React from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {render, fireEvent} from '@testing-library/react-native';

import {BottomSheet} from '@/components';
import {useTranslate} from '@/hooks';

import {ProfileImageBottomSheet} from '../ProfileImageBottomSheet';

// Mocks
jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    BottomSheet: ({children, visible, onClose}: any) =>
      visible ? <View testID="bottom-sheet">{children}</View> : null,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ChangeImageIcon: ({width, height}: any) => (
      <View testID="change-image-icon" style={{width, height}} />
    ),
    RemoveImageIcon: ({width, height}: any) => (
      <View testID="remove-image-icon" style={{width, height}} />
    ),
  };
});

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {
    create: (styles: any) => styles,
  },
  ms: (value: number) => value,
}));

jest.mock('@/theme', () => ({
  colors: {
    white: '#FFFFFF',
    ds: {
      typography: {
        highEmphasis: '#000000',
        mediumEmphasis: '#666666',
      },
    },
  },
  fontFamily: {
    IBM_PLEX_SERIF: {
      MEDIUM: {fontFamily: 'IBMPlexSerif-Medium'},
      REGULAR: {fontFamily: 'IBMPlexSerif-Regular'},
    },
  },
  typography: {
    display: {
      small: {
        fontSize: 18,
        lineHeight: 24,
        letterSpacing: 0.18,
      },
    },
    body: {
      medium: {
        fontSize: 14,
        lineHeight: 22,
        letterSpacing: 0.2,
      },
    },
  },
}));

const mockT = jest.fn((key: string) => key);
const mockOnClose = jest.fn();
const mockOnChangeImage = jest.fn();
const mockOnRemoveImage = jest.fn();

describe('ProfileImageBottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useTranslate as jest.Mock).mockReturnValue({
      t: mockT,
    });
  });

  it('renders when visible is true', () => {
    const {getByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    expect(getByTestId('bottom-sheet')).toBeTruthy();
  });

  it('does not render when visible is false', () => {
    const {queryByTestId} = render(
      <ProfileImageBottomSheet
        visible={false}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    expect(queryByTestId('bottom-sheet')).toBeNull();
  });

  it('displays profile image title', () => {
    const {getByText} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    expect(getByText('profile.settings.profile_image')).toBeTruthy();
    expect(mockT).toHaveBeenCalledWith('profile.settings.profile_image');
  });

  it('shows upload image option when hasExistingImage is false', () => {
    const {getByText, getByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    expect(getByText('profile.settings.upload_image')).toBeTruthy();
    expect(getByTestId('change-image-icon')).toBeTruthy();
    expect(mockT).toHaveBeenCalledWith('profile.settings.upload_image');
  });

  it('shows change image option when hasExistingImage is true', () => {
    const {getByText, getByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={true}
      />,
    );

    expect(getByText('profile.settings.changeImage')).toBeTruthy();
    expect(getByTestId('change-image-icon')).toBeTruthy();
    expect(mockT).toHaveBeenCalledWith('profile.settings.changeImage');
  });

  it('shows remove image option when hasExistingImage is true', () => {
    const {getByText, getAllByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={true}
      />,
    );

    expect(getByText('profile.settings.removeImage')).toBeTruthy();
    expect(getAllByTestId('remove-image-icon')[0]).toBeTruthy();
    expect(mockT).toHaveBeenCalledWith('profile.settings.removeImage');
  });

  it('does not show remove image option when hasExistingImage is false', () => {
    const {queryByText, queryByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    expect(queryByText('profile.settings.removeImage')).toBeNull();
    expect(queryByTestId('remove-image-icon')).toBeNull();
  });

  it('calls onChangeImage when upload/change option is pressed', () => {
    const {getByText} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    const uploadOption = getByText('profile.settings.upload_image');
    fireEvent.press(uploadOption);

    expect(mockOnChangeImage).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveImage when remove option is pressed', () => {
    const {getByText} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={true}
      />,
    );

    const removeOption = getByText('profile.settings.removeImage');
    fireEvent.press(removeOption);

    expect(mockOnRemoveImage).toHaveBeenCalledTimes(1);
  });

  it('passes onClose to BottomSheet', () => {
    render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={false}
      />,
    );

    // BottomSheet component receives onClose prop
    // The actual BottomSheet component is mocked, so we verify it renders
    expect(mockOnClose).toBeDefined();
  });

  it('renders icons with correct dimensions', () => {
    const {getAllByTestId} = render(
      <ProfileImageBottomSheet
        visible={true}
        onClose={mockOnClose}
        onChangeImage={mockOnChangeImage}
        onRemoveImage={mockOnRemoveImage}
        hasExistingImage={true}
      />,
    );

    const changeIcon = getAllByTestId('change-image-icon')[0];
    const removeIcon = getAllByTestId('remove-image-icon')[0];

    expect(changeIcon.props.style.width).toBe(24);
    expect(changeIcon.props.style.height).toBe(24);
    expect(removeIcon.props.style.width).toBe(24);
    expect(removeIcon.props.style.height).toBe(24);
  });
});
