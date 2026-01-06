/**
 * Mock utility functions for AchievementsScreen
 * These will be replaced when API is available
 */

export interface Achievement {
  id: string;
  titleKey: string; // Translation key for title
  descriptionKey: string; // Translation key for description
  icon: string; // Dummy icon emoji/text for now
  isUnlocked: boolean;
}

export const generateMockAchievements = (): Achievement[] => [
  {
    id: 'first-steps',
    titleKey: 'Achievements.firstSteps.title',
    descriptionKey: 'Achievements.firstSteps.description',
    icon: '⏳',
    isUnlocked: true,
  },
  {
    id: 'consistent-start',
    titleKey: 'Achievements.consistentStart.title',
    descriptionKey: 'Achievements.consistentStart.description',
    icon: '👍',
    isUnlocked: true,
  },
  {
    id: 'milestone-hunter',
    titleKey: 'Achievements.milestoneHunter.title',
    descriptionKey: 'Achievements.milestoneHunter.description',
    icon: '🏆',
    isUnlocked: true,
  },
  {
    id: 'consistent-start-locked',
    titleKey: 'Achievements.consistentStart.title',
    descriptionKey: 'Achievements.consistentStart.description',
    icon: '🔒',
    isUnlocked: false,
  },
  {
    id: '365-champion',
    titleKey: 'Achievements.365Champion.title',
    descriptionKey: 'Achievements.365Champion.description',
    icon: '🔒',
    isUnlocked: false,
  },
  {
    id: 'week-warrior',
    titleKey: 'Achievements.weekWarrior.title',
    descriptionKey: 'Achievements.weekWarrior.description',
    icon: '🔒',
    isUnlocked: false,
  },
];
