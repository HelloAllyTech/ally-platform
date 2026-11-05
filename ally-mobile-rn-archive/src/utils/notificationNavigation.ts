import {NavigationContainerRef, StackActions} from '@react-navigation/native';

import {
  DEBRIEF_NOTIFICATION_TYPES,
  REMINDER_NOTIFICATION_TYPE,
  SCREEN_NAMES,
} from '@/constants';

import type {RootStackParamList} from '../navigation/types';

/** Is this notification payload a server-sent engagement reminder? */
export const isReminderNotification = (
  data?: Record<string, unknown>,
): boolean => data?.type === REMINDER_NOTIFICATION_TYPE;

/**
 * The session a debrief notification (`DEBRIEF_READY` / `DEBRIEF_REVIEWED`)
 * opens, or undefined for anything else. Push sends `type` inside the data;
 * the in-app feed keeps it on the item, so it can be passed separately.
 */
export const getDebriefNotificationSessionId = (
  data?: Record<string, unknown>,
  type: unknown = data?.type,
): string | undefined => {
  if (typeof type !== 'string' || !DEBRIEF_NOTIFICATION_TYPES.includes(type)) {
    return undefined;
  }
  const sessionId = data?.scenarioSessionId;
  return sessionId === undefined || sessionId === null || sessionId === ''
    ? undefined
    : String(sessionId);
};

/**
 * Runs `navigate` once the navigator has left SPLASH (same trick as the
 * leaderboard initial-notification path); does nothing if it isn't ready.
 */
const navigateWhenPastSplash = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
  navigate: () => void,
): void => {
  if (!navigationRef.isReady()) return;

  const currentRoute = navigationRef.getCurrentRoute()?.name;
  if (currentRoute && currentRoute !== SCREEN_NAMES.SPLASH) {
    navigate();
    return;
  }
  const unsubscribe = navigationRef.addListener('state', () => {
    const route = navigationRef.getCurrentRoute()?.name;
    if (route && route !== SCREEN_NAMES.SPLASH) {
      unsubscribe();
      navigate();
    }
  });
};

/**
 * Routes a reminder notification tap. The payload may carry a `screen` hint
 * (e.g. "Simulations"); anything unknown lands on the Notifications feed.
 */
export const handleReminderNavigation = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
  data?: Record<string, unknown>,
): void => {
  const target =
    data?.screen === SCREEN_NAMES.SIMULATIONS
      ? SCREEN_NAMES.SIMULATIONS
      : SCREEN_NAMES.NOTIFICATIONS;

  navigateWhenPastSplash(navigationRef, () => {
    navigationRef.navigate(target as keyof RootStackParamList as never);
  });
};

/**
 * Opens a session's debrief from a notification tap: the SimulationFeedback
 * screen, which lands on its Debrief tab. Pushed rather than navigated to, so
 * a feedback screen already open for another session isn't reused with the
 * wrong session's state. Not `fromLogs`: this is the learner's own debrief,
 * so Ask Ally stays open — the same as reopening it from Course Progress.
 */
export const handleDebriefNavigation = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
  scenarioSessionId: string,
): void => {
  navigateWhenPastSplash(navigationRef, () => {
    navigationRef.dispatch(
      StackActions.push(SCREEN_NAMES.SIMULATION_FEEDBACK, {scenarioSessionId}),
    );
  });
};
