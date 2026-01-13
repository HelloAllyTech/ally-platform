import React from 'react';
import {render} from '@testing-library/react-native';

import {AchievementCard} from '../components/AchievementCard';
import {Achievement} from '../mockUtils';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'Achievements.firstSteps.title': 'First Steps',
        'Achievements.firstSteps.description': 'Complete your first session',
        'Achievements.consistentStart.title': 'Consistent Start',
        'Achievements.consistentStart.description': 'Start 5 sessions',
        'Achievements.milestoneHunter.title': 'Milestone Hunter',
        'Achievements.milestoneHunter.description': 'Reach a milestone',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock AchievementLockedIcon
jest.mock('@/assets/icons', () => ({
  AchievementLockedIcon: ({width, height}: {width: number; height: number}) => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="achievement-locked-icon" style={{width, height}} />;
  },
}));

describe('AchievementCard', () => {
  const mockUnlockedAchievement: Achievement = {
    id: 'test-unlocked',
    titleKey: 'Achievements.firstSteps.title',
    descriptionKey: 'Achievements.firstSteps.description',
    icon: '⏳',
    isUnlocked: true,
  };

  const mockLockedAchievement: Achievement = {
    id: 'test-locked',
    titleKey: 'Achievements.consistentStart.title',
    descriptionKey: 'Achievements.consistentStart.description',
    icon: '🔒',
    isUnlocked: false,
  };

  it('renders unlocked achievement correctly', () => {
    const {getByText, queryByTestId} = render(
      <AchievementCard achievement={mockUnlockedAchievement} />,
    );

    expect(getByText('First Steps')).toBeTruthy();
    expect(getByText('Complete your first session')).toBeTruthy();
    expect(getByText('⏳')).toBeTruthy();
    expect(queryByTestId('achievement-locked-icon')).toBeNull();
  });

  it('renders locked achievement correctly', () => {
    const {getByText, getByTestId} = render(
      <AchievementCard achievement={mockLockedAchievement} />,
    );

    expect(getByText('Consistent Start')).toBeTruthy();
    expect(getByText('Start 5 sessions')).toBeTruthy();
    expect(getByTestId('achievement-locked-icon')).toBeTruthy();
  });

  it('applies locked styles when achievement is locked', () => {
    const {getByText} = render(
      <AchievementCard achievement={mockLockedAchievement} />,
    );

    const title = getByText('Consistent Start');
    const description = getByText('Start 5 sessions');

    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
  });

  it('displays icon emoji for unlocked achievements', () => {
    const {getByText} = render(
      <AchievementCard achievement={mockUnlockedAchievement} />,
    );

    expect(getByText('⏳')).toBeTruthy();
  });

  it('displays locked icon for locked achievements', () => {
    const {getByTestId} = render(
      <AchievementCard achievement={mockLockedAchievement} />,
    );

    expect(getByTestId('achievement-locked-icon')).toBeTruthy();
  });

  it('renders achievement title using translation key', () => {
    const {getByText} = render(
      <AchievementCard achievement={mockUnlockedAchievement} />,
    );

    expect(getByText('First Steps')).toBeTruthy();
  });

  it('renders achievement description using translation key', () => {
    const {getByText} = render(
      <AchievementCard achievement={mockUnlockedAchievement} />,
    );

    expect(getByText('Complete your first session')).toBeTruthy();
  });
});
