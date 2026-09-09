/**
 * @format
 */

import {registerGlobals} from '@livekit/react-native';
import notifee, {EventType} from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import {AppRegistry} from 'react-native';

import {name as appName} from './app.json';
import {App} from './src';
import {LEADERBOARD_NOTIFICATION_ID} from './src/constants';
import {navigateToLeaderboard} from './src/navigation/RootNavigator';
import {displayRemoteMessage} from './src/services/pushNotificationService';
import {isReminderNotification} from './src/utils/notificationNavigation';

// Handle notification press when app is in the background (not killed)
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (type !== EventType.PRESS) return;
  if (detail.notification?.id === LEADERBOARD_NOTIFICATION_ID) {
    navigateToLeaderboard();
    return;
  }
  // Engagement reminders navigate via the initial-notification /
  // foreground-event paths once the app is up; nothing to do here beyond
  // letting the press open the app.
  if (isReminderNotification(detail.notification?.data)) {
    return;
  }
});

// Server push (FCM) arrives data-only; display it via Notifee even when the
// app is backgrounded/killed. Must be registered at module scope, before
// AppRegistry.registerComponent.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  await displayRemoteMessage(remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);

// Initialize LiveKit RN WebRTC globals once at app start
registerGlobals();
