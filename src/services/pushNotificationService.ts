import notifee, {AndroidImportance} from '@notifee/react-native';
import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import {Platform} from 'react-native';

import {REMINDERS_CHANNEL_ID} from '@/constants';
import type {AppDispatch} from '@/store/store';
import {logger} from '@/utils/logger';

import {notificationsApi} from './notificationsApi';

/**
 * Server-sent push (FCM) plumbing for engagement reminders. The backend sends
 * DATA-ONLY messages ({title, body, type, screen, ...}) so every notification
 * is rendered locally through Notifee — one look, one tap-handling path
 * (notifee events) across foreground/background/killed.
 */

export const createRemindersChannel = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: REMINDERS_CHANNEL_ID,
    name: 'Reminders',
    importance: AndroidImportance.HIGH,
  });
};

/** Render a data-only FCM message as a local Notifee notification. */
export const displayRemoteMessage = async (
  message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> => {
  const data = message.data ?? {};
  const title = (data.title as string) ?? 'Ally';
  const body = (data.body as string) ?? '';
  if (!body) return;

  await notifee.displayNotification({
    title,
    body,
    data,
    android: {
      channelId: REMINDERS_CHANNEL_ID,
      pressAction: {id: 'default'},
    },
  });
};

/**
 * Fetches the FCM token and registers it with the backend. Safe to call on
 * every login/app start (the backend upserts). Returns the token so callers
 * can hold it for later deletion.
 */
export const registerDeviceForPush = async (
  dispatch: AppDispatch,
): Promise<string | null> => {
  try {
    const token = await messaging().getToken();
    if (!token) return null;
    await dispatch(
      notificationsApi.endpoints.registerDeviceToken.initiate({token}),
    );
    return token;
  } catch (error) {
    logger.error(`Failed to register device for push: ${error}`);
    return null;
  }
};

/** Deletes the device token server-side and locally (logout). */
export const unregisterDeviceForPush = async (
  dispatch: AppDispatch,
): Promise<void> => {
  try {
    const token = await messaging().getToken();
    if (token) {
      await dispatch(
        notificationsApi.endpoints.deleteDeviceToken.initiate({token}),
      );
    }
    await messaging().deleteToken();
  } catch (error) {
    logger.error(`Failed to unregister device for push: ${error}`);
  }
};

/** Re-register whenever FCM rotates the token. Returns the unsubscribe fn. */
export const subscribeToTokenRefresh = (dispatch: AppDispatch): (() => void) =>
  messaging().onTokenRefresh(token => {
    dispatch(notificationsApi.endpoints.registerDeviceToken.initiate({token}));
  });

/** Foreground FCM messages → Notifee display. Returns the unsubscribe fn. */
export const subscribeToForegroundMessages = (): (() => void) =>
  messaging().onMessage(async message => {
    await displayRemoteMessage(message);
  });
