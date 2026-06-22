import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {BadgePopup} from '../BadgePopup';

const mockCloseBadge = jest.fn();

jest.mock('@/hooks/useBadgePopup', () => ({
  useBadgePopup: jest.fn(() => ({
    currentBadge: null,
    isFirstBadge: false,
    isBadgesLoading: false,
    closeBadge: mockCloseBadge,
  })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {language: 'en'},
  }),
}));

jest.mock('react-native-confetti-cannon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/assets', () => ({
  CloseIcon: 'CloseIcon',
}));

jest.mock('@/components/NetworkImage', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    NetworkImage: () => React.createElement(View, {testID: 'network-image'}),
  };
});

describe('BadgePopup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal when no current badge (visible is false)', () => {
    const {UNSAFE_getByType} = render(<BadgePopup />);
    const {Modal} = require('react-native');
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(false);
  });

  it('modal is not visible when isBadgesLoading is true and no currentBadge', () => {
    const {useBadgePopup} = require('@/hooks/useBadgePopup');
    useBadgePopup.mockImplementation(() => ({
      currentBadge: null,
      isFirstBadge: false,
      isBadgesLoading: true,
      closeBadge: mockCloseBadge,
    }));
    const {UNSAFE_getByType} = render(<BadgePopup />);
    const {Modal} = require('react-native');
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(false);
  });

  it('renders badge content when currentBadge is set', () => {
    const badge = {
      id: 'badge-1',
      name: 'First Step',
      description: 'You completed your first simulation',
      imageUrl: 'https://example.com/badge.png',
    };
    const {useBadgePopup} = require('@/hooks/useBadgePopup');
    useBadgePopup.mockReturnValueOnce({
      currentBadge: badge,
      isFirstBadge: false,
      isBadgesLoading: false,
      closeBadge: mockCloseBadge,
    });

    const {getByText, UNSAFE_getByType} = render(<BadgePopup />);
    expect(getByText('First Step')).toBeTruthy();
    expect(getByText('You completed your first simulation')).toBeTruthy();
    expect(getByText('achievements.modal.newBadge')).toBeTruthy();

    const {Modal} = require('react-native');
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(true);
  });

  it('calls closeBadge when modal onRequestClose is triggered', () => {
    const badge = {id: '1', name: 'Badge', description: 'Desc', imageUrl: ''};
    const {useBadgePopup} = require('@/hooks/useBadgePopup');
    useBadgePopup.mockReturnValueOnce({
      currentBadge: badge,
      isFirstBadge: false,
      isBadgesLoading: false,
      closeBadge: mockCloseBadge,
    });

    const {UNSAFE_getByType} = render(<BadgePopup />);
    const {Modal} = require('react-native');
    const modal = UNSAFE_getByType(Modal);
    modal.props.onRequestClose();
    expect(mockCloseBadge).toHaveBeenCalledTimes(1);
  });
});
