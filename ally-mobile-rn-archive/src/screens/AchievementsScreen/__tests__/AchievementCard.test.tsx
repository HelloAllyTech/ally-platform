import React from 'react';
import {render} from '@testing-library/react-native';

import {AchievementCard} from '../components/AchievementCard';
import {Badge} from '@/types';
import {BadgeCategory, LockStatus, ViewedStatus} from '@/constants/badges';

// Mock AchievementLockedIcon
jest.mock('@/assets/icons', () => ({
  AchievementLockedIcon: ({width, height}: {width: number; height: number}) => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="achievement-locked-icon" style={{width, height}} />;
  },
}));

describe('AchievementCard', () => {
  const mockUnlockedBadge: Badge = {
    id: 'test-unlocked',
    code: 'FIRST_STEPS',
    name: 'First Step',
    description: 'Complete your first session',
    imageUrl: 'https://example.com/badge.png',
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: {count: 1},
    viewedStatus: ViewedStatus.VIEWED,
    lockStatus: LockStatus.UNLOCKED,
  };

  const mockLockedBadge: Badge = {
    id: 'test-locked',
    code: 'CONSISTENT_START',
    name: 'Consistent Start',
    description: 'Start 5 sessions',
    imageUrl: 'https://example.com/badge.png',
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: {count: 5},
    viewedStatus: ViewedStatus.UNVIEWED,
    lockStatus: LockStatus.LOCKED,
  };

  it('renders unlocked achievement correctly', () => {
    const {getByText, queryByTestId} = render(
      <AchievementCard badge={mockUnlockedBadge} />,
    );

    expect(getByText('First Step')).toBeTruthy();
    expect(getByText('Complete your first session')).toBeTruthy();
    expect(queryByTestId('achievement-locked-icon')).toBeNull();
  });

  it('renders locked achievement correctly', () => {
    const {getByText, getByTestId} = render(
      <AchievementCard badge={mockLockedBadge} />,
    );

    expect(getByText('Consistent Start')).toBeTruthy();
    expect(getByText('Start 5 sessions')).toBeTruthy();
    expect(getByTestId('achievement-locked-icon')).toBeTruthy();
  });

  it('applies locked styles when achievement is locked', () => {
    const {getByText} = render(
      <AchievementCard badge={mockLockedBadge} />,
    );

    const title = getByText('Consistent Start');
    const description = getByText('Start 5 sessions');

    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
  });

  it('displays badge image for unlocked achievements', () => {
    const {queryByTestId} = render(
      <AchievementCard badge={mockUnlockedBadge} />,
    );

    expect(queryByTestId('achievement-locked-icon')).toBeNull();
  });

  it('displays locked icon for locked achievements', () => {
    const {getByTestId} = render(
      <AchievementCard badge={mockLockedBadge} />,
    );

    expect(getByTestId('achievement-locked-icon')).toBeTruthy();
  });

  it('renders achievement title correctly', () => {
    const {getByText} = render(
      <AchievementCard badge={mockUnlockedBadge} />,
    );

    expect(getByText('First Step')).toBeTruthy();
  });

  it('renders achievement description correctly', () => {
    const {getByText} = render(
      <AchievementCard badge={mockUnlockedBadge} />,
    );

    expect(getByText('Complete your first session')).toBeTruthy();
  });
});
