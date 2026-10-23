import type {NavigationContainerRef} from '@react-navigation/native';

import {REMINDER_NOTIFICATION_TYPE, SCREEN_NAMES} from '@/constants';

import type {RootStackParamList} from '../navigation/types';

/** Is this notification payload a server-sent engagement reminder? */
export const isReminderNotification = (
  data?: Record<string, unknown>,
): boolean => data?.type === REMINDER_NOTIFICATION_TYPE;

/**
 * Routes a reminder notification tap. The payload may carry a `screen` hint
 * (e.g. "Simulations"); anything unknown lands on the Notifications feed.
 * Waits for the navigator to leave SPLASH first (same trick as the
 * leaderboard initial-notification path).
 */
export const handleReminderNavigation = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
  data?: Record<string, unknown>,
): void => {
  const target =
    data?.screen === SCREEN_NAMES.SIMULATIONS
      ? SCREEN_NAMES.SIMULATIONS
      : SCREEN_NAMES.NOTIFICATIONS;

  const doNavigate = () => {
    navigationRef.navigate(target as keyof RootStackParamList as never);
  };

  if (!navigationRef.isReady()) return;

  const currentRoute = navigationRef.getCurrentRoute()?.name;
  if (currentRoute && currentRoute !== SCREEN_NAMES.SPLASH) {
    doNavigate();
    return;
  }
  const unsubscribe = navigationRef.addListener('state', () => {
    const route = navigationRef.getCurrentRoute()?.name;
    if (route && route !== SCREEN_NAMES.SPLASH) {
      unsubscribe();
      doNavigate();
    }
  });
};
