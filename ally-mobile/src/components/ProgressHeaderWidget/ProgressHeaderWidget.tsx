import React, {useCallback} from 'react';
import {useRoute} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';

import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useProgressSummary} from '@/hooks';

import {LevelIndicator} from '../LevelIndicator';

/**
 * The always-visible half of the Progress feature.
 *
 * Rendered by TabScreenHeader itself rather than passed in per screen, for two reasons:
 * `rightContent` is already occupied on the two screens a learner uses most (credits on
 * Simulations, badge count on Leaderboard), and "visible across every screen" should not
 * depend on each new screen remembering to opt in.
 *
 * Renders nothing at all — not a placeholder, not a spinner — until the org gate resolves
 * true. A widget that appears and then vanishes is worse than one that arrives a moment
 * late.
 */
export const ProgressHeaderWidget: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const route = useRoute();
  const {summary, canViewProgress} = useProgressSummary();

  // The Progress screen renders the same shared header, and a widget that navigates to
  // the screen you are already on is a dead control sitting next to a hero that shows
  // the same ring.
  const isOnProgressScreen = route.name === SCREEN_NAMES.PROGRESS;

  const handlePress = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.PROGRESS as never);
  }, [navigation]);

  if (!canViewProgress || !summary || isOnProgressScreen) {
    return null;
  }

  return (
    <LevelIndicator
      level={summary.level}
      progress={summary.progress}
      isMaxLevel={summary.isMaxLevel}
      onPress={handlePress}
      accessibilityLabel={t('progress.a11y.navLevel', {
        level: summary.level,
      })}
    />
  );
};
