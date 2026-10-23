import {PermissionsAndroid, Platform} from 'react-native';

// Define the notifee mock — jest.fn() calls go inside the factory so they
// are available at hoist time. We access them later via require().
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(),
    requestPermission: jest.fn(),
    createTriggerNotification: jest.fn(),
    cancelTriggerNotification: jest.fn(),
  },
  AndroidImportance: {HIGH: 4},
  EventType: {PRESS: 1, DISMISSED: 2},
  TriggerType: {TIMESTAMP: 0},
  RepeatFrequency: {WEEKLY: 2},
}));

// Mock env so schedule config is deterministic regardless of .env file
jest.mock('@/config/env', () => ({
  env: {
    NOTIFICATION_SCHEDULE_DAY: 1,    // Monday
    NOTIFICATION_SCHEDULE_HOUR: 11,  // 11 AM
    NOTIFICATION_SCHEDULE_MINUTE: 0, // :00
  },
}));

import {LEADERBOARD_NOTIFICATION_ID} from '@/constants';
import {
  cancelWeeklyLeaderboardNotification,
  createAndroidChannel,
  getNextMondayAt11amIST,
  getNextScheduledNotificationTime,
  requestNotificationPermission,
  scheduleWeeklyLeaderboardNotification,
} from '../notificationService';

// Grab the mocked notifee default so we can assert on its methods
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockNotifee = require('@notifee/react-native').default as jest.Mocked<{
  createChannel: jest.Mock;
  requestPermission: jest.Mock;
  createTriggerNotification: jest.Mock;
  cancelTriggerNotification: jest.Mock;
}>;

// ─── getNextScheduledNotificationTime ────────────────────────────────────────
// Uses local timezone — tests assert on date components rather than raw UTC
// timestamps to stay timezone-agnostic.

describe('getNextScheduledNotificationTime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns today at target time when today is target day and time has not passed', () => {
    // Monday 2026-03-23 10:00 local — target is Monday 11:00
    jest.setSystemTime(new Date(2026, 2, 23, 10, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(23);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns today at target time when it is target day at exactly target time', () => {
    // Monday 2026-03-23 11:00 local — exactly on time
    jest.setSystemTime(new Date(2026, 2, 23, 11, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(23);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns next week when today is target day but time has passed', () => {
    // Monday 2026-03-23 12:00 local — past 11:00
    jest.setSystemTime(new Date(2026, 2, 23, 12, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(30); // Monday 2026-03-30
    expect(result.getDay()).toBe(1);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  it('schedules next week when target day minute just passed (boundary check)', () => {
    // Monday 2026-03-23 11:01 — one minute after target
    jest.setSystemTime(new Date(2026, 2, 23, 11, 1, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(30);
    expect(result.getDay()).toBe(1);
  });

  it('returns next Monday when today is Sunday', () => {
    // Sunday 2026-03-22 12:00 local
    jest.setSystemTime(new Date(2026, 2, 22, 12, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(23); // Monday 2026-03-23
    expect(result.getDay()).toBe(1);
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday when today is Wednesday', () => {
    // Wednesday 2026-03-25 12:00 local
    jest.setSystemTime(new Date(2026, 2, 25, 12, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(30); // Monday 2026-03-30
    expect(result.getDay()).toBe(1);
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday when today is Saturday', () => {
    // Saturday 2026-03-28 12:00 local
    jest.setSystemTime(new Date(2026, 2, 28, 12, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(1, 11, 0));
    expect(result.getDate()).toBe(30); // Monday 2026-03-30
    expect(result.getDay()).toBe(1);
    expect(result.getHours()).toBe(11);
  });

  it('works with a non-Monday target day and time', () => {
    // Thursday 2026-03-26 09:00 local — target is Thursday 14:30
    jest.setSystemTime(new Date(2026, 2, 26, 9, 0, 0));
    const result = new Date(getNextScheduledNotificationTime(4, 14, 30));
    expect(result.getDay()).toBe(4); // Thursday
    expect(result.getDate()).toBe(26); // Same day
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  it('always returns a timestamp at or after the current time', () => {
    const now = Date.now();
    expect(getNextScheduledNotificationTime(1, 11, 0)).toBeGreaterThanOrEqual(now - 1);
  });
});

// ─── getNextMondayAt11amIST ───────────────────────────────────────────────────
// Delegates to getNextScheduledNotificationTime using env config (mocked to
// day=1/Monday, hour=11, minute=0). Tests are timezone-agnostic: they assert on
// date components of the result, not raw UTC timestamps.

describe('getNextMondayAt11amIST', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns today at 11:00 local when it is Monday before 11 AM', () => {
    jest.setSystemTime(new Date(2026, 2, 23, 10, 0, 0)); // Mon 10:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(23);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns today at 11:00 local when it is Monday at exactly 11:00 AM', () => {
    jest.setSystemTime(new Date(2026, 2, 23, 11, 0, 0)); // Mon 11:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(23);
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday 11 AM local when it is Monday after 11 AM', () => {
    jest.setSystemTime(new Date(2026, 2, 23, 12, 0, 0)); // Mon 12:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30); // Mon 2026-03-30
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday 11 AM local when it is Sunday', () => {
    jest.setSystemTime(new Date(2026, 2, 22, 12, 0, 0)); // Sun 12:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(23); // Mon 2026-03-23
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday 11 AM local when it is Wednesday', () => {
    jest.setSystemTime(new Date(2026, 2, 25, 12, 0, 0)); // Wed 12:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30); // Mon 2026-03-30
    expect(result.getHours()).toBe(11);
  });

  it('returns next Monday 11 AM local when it is Saturday', () => {
    jest.setSystemTime(new Date(2026, 2, 28, 12, 0, 0)); // Sat 12:00
    const result = new Date(getNextMondayAt11amIST());
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30); // Mon 2026-03-30
    expect(result.getHours()).toBe(11);
  });

  it('always returns a timestamp at or after the current time', () => {
    const now = Date.now();
    expect(getNextMondayAt11amIST()).toBeGreaterThanOrEqual(now - 1);
  });

  it('reads schedule config from env (delegates to getNextScheduledNotificationTime)', () => {
    jest.setSystemTime(new Date(2026, 2, 23, 10, 0, 0)); // Mon 10:00
    // env mock: day=1, hour=11, minute=0
    expect(getNextMondayAt11amIST()).toBe(getNextScheduledNotificationTime(1, 11, 0));
  });
});

// ─── createAndroidChannel ─────────────────────────────────────────────────────

describe('createAndroidChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a channel on Android', async () => {
    (Platform as any).OS = 'android';
    await createAndroidChannel();
    expect(mockNotifee.createChannel).toHaveBeenCalledWith({
      id: 'leaderboard',
      name: 'Community Leaderboard',
      importance: 4,
    });
  });

  it('does nothing on iOS', async () => {
    (Platform as any).OS = 'ios';
    await createAndroidChannel();
    expect(mockNotifee.createChannel).not.toHaveBeenCalled();
  });
});

// ─── requestNotificationPermission ───────────────────────────────────────────

describe('requestNotificationPermission', () => {
  let mockRequest: jest.Mock;

  // Platform.Version is a getter-only in RN's test environment — override via
  // Object.defineProperty so the Android version check can be controlled.
  const setPlatformVersion = (version: number) => {
    Object.defineProperty(Platform, 'Version', {
      value: version,
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Direct assignment works around RN's native prototype method not being
    // interceptable via jest.spyOn in the test environment.
    mockRequest = jest.fn().mockResolvedValue('granted');
    (PermissionsAndroid as any).request = mockRequest;
  });

  afterEach(() => {
    // Remove own property so the prototype method is accessible again.
    delete (PermissionsAndroid as any).request;
  });

  it('calls notifee.requestPermission on iOS', async () => {
    (Platform as any).OS = 'ios';
    await requestNotificationPermission();
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('calls PermissionsAndroid.request on Android API >= 33', async () => {
    (Platform as any).OS = 'android';
    setPlatformVersion(33);
    await requestNotificationPermission();
    expect(mockRequest).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });

  it('does not call PermissionsAndroid.request on Android API < 33', async () => {
    (Platform as any).OS = 'android';
    setPlatformVersion(32);
    await requestNotificationPermission();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });
});

// ─── scheduleWeeklyLeaderboardNotification ────────────────────────────────────

describe('scheduleWeeklyLeaderboardNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls createTriggerNotification with the correct notification id and body', async () => {
    await scheduleWeeklyLeaderboardNotification();
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
    const [notification] = mockNotifee.createTriggerNotification.mock.calls[0];
    expect(notification.id).toBe(LEADERBOARD_NOTIFICATION_ID);
    expect(notification.body).toBe('Time to view weekly community leaderboard');
  });

  it('schedules with a TIMESTAMP trigger and WEEKLY repeat frequency', async () => {
    await scheduleWeeklyLeaderboardNotification();
    const [, trigger] = mockNotifee.createTriggerNotification.mock.calls[0];
    expect(trigger.type).toBe(0); // TriggerType.TIMESTAMP
    expect(trigger.repeatFrequency).toBe(2); // RepeatFrequency.WEEKLY
  });

  it('sets the trigger timestamp to next Monday at 11 AM local time', async () => {
    // Monday 2026-03-23 10:00 local → trigger should land on same day at 11:00 local
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 23, 10, 0, 0));

    await scheduleWeeklyLeaderboardNotification();

    const [notification, trigger] =
      mockNotifee.createTriggerNotification.mock.calls[0];

    // Verify timestamp represents Monday 2026-03-23 11:00 local
    const triggerDate = new Date(trigger.timestamp);
    expect(triggerDate.getDay()).toBe(1);   // Monday
    expect(triggerDate.getDate()).toBe(23);
    expect(triggerDate.getHours()).toBe(11);
    expect(triggerDate.getMinutes()).toBe(0);
    // scheduledAt in notification data must match the trigger timestamp
    expect(notification.data?.scheduledAt).toBe(String(trigger.timestamp));

    jest.useRealTimers();
  });

  it('sets the Android channelId and pressAction', async () => {
    await scheduleWeeklyLeaderboardNotification();
    const [notification] = mockNotifee.createTriggerNotification.mock.calls[0];
    expect(notification.android?.channelId).toBe('leaderboard');
    expect(notification.android?.pressAction?.id).toBe('default');
  });
});

// ─── cancelWeeklyLeaderboardNotification ─────────────────────────────────────

describe('cancelWeeklyLeaderboardNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels the leaderboard trigger notification by id', async () => {
    await cancelWeeklyLeaderboardNotification();
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith(
      LEADERBOARD_NOTIFICATION_ID,
    );
  });
});
