import notifee, {
  AndroidImportance,
  EventType,
  RepeatFrequency,
  TriggerType,
} from '@notifee/react-native';
import {PermissionsAndroid, Platform} from 'react-native';

import {env} from '@/config/env';
import {LEADERBOARD_CHANNEL_ID, LEADERBOARD_NOTIFICATION_ID} from '@/constants';

export const createAndroidChannel = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: LEADERBOARD_CHANNEL_ID,
    name: 'Community Leaderboard',
    importance: AndroidImportance.HIGH,
  });
};

export const requestNotificationPermission = async (): Promise<void> => {
  if (Platform.OS === 'ios') {
    await notifee.requestPermission();
    return;
  }
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  }
};

/**
 * Calculates the next occurrence of a scheduled notification.
 *
 * @param targetDayOfWeek - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param targetHour - Hour in 24-hour format (0-23)
 * @param targetMinute - Minutes (0-59)
 * @returns Timestamp in milliseconds (UTC, using device's local timezone)
 *
 * If today is the target day and the time hasn't passed, returns today's time.
 * Otherwise, returns the next occurrence of that day/time.
 */
export const getNextScheduledNotificationTime = (
  targetDayOfWeek: number,
  targetHour: number,
  targetMinute: number,
): number => {
  const now = new Date();
  const currentDayOfWeek = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Check if we can schedule for today
  const isTargetDayToday = currentDayOfWeek === targetDayOfWeek;
  const hasTimePassed =
    currentHour > targetHour ||
    (currentHour === targetHour && currentMinute > targetMinute);

  // Calculate days to add
  let daysToAdd = 0;
  if (!isTargetDayToday) {
    daysToAdd = (targetDayOfWeek - currentDayOfWeek + 7) % 7;
  } else if (hasTimePassed) {
    daysToAdd = 7; // Today is target day but time passed, schedule for next week
  }

  // Create target date
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysToAdd);
  targetDate.setHours(targetHour, targetMinute, 0, 0);

  return targetDate.getTime();
};

/**
 * Returns the timestamp (ms) of the next scheduled notification using config.
 * Reads schedule from environment variables or uses sensible defaults.
 * Uses the device's local timezone automatically.
 */
export const getNextMondayAt11amIST = (): number => {
  return getNextScheduledNotificationTime(
    env.NOTIFICATION_SCHEDULE_DAY,
    env.NOTIFICATION_SCHEDULE_HOUR,
    env.NOTIFICATION_SCHEDULE_MINUTE,
  );
};

export const scheduleWeeklyLeaderboardNotification =
  async (): Promise<void> => {
    const productionTimestamp = getNextMondayAt11amIST();

    await notifee.createTriggerNotification(
      {
        id: LEADERBOARD_NOTIFICATION_ID,
        title: 'Ally',
        body: 'Time to view weekly community leaderboard',
        data: {scheduledAt: productionTimestamp.toString()},
        android: {
          channelId: LEADERBOARD_CHANNEL_ID,
          pressAction: {id: 'default'},
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: productionTimestamp,
        repeatFrequency: RepeatFrequency.WEEKLY,
      },
    );
  };

export const cancelWeeklyLeaderboardNotification = async (): Promise<void> => {
  await notifee.cancelTriggerNotification(LEADERBOARD_NOTIFICATION_ID);
};

export {EventType};
