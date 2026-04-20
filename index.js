/**
 * @format
 */

import {registerGlobals} from '@livekit/react-native';
import notifee, {EventType} from '@notifee/react-native';
import {AppRegistry} from 'react-native';

import {name as appName} from './app.json';
import {App} from './src';
import {LEADERBOARD_NOTIFICATION_ID} from './src/constants';
import {navigateToLeaderboard} from './src/navigation/RootNavigator';

// Handle notification press when app is in the background (not killed)
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (
    type === EventType.PRESS &&
    detail.notification?.id === LEADERBOARD_NOTIFICATION_ID
  ) {
    navigateToLeaderboard();
  }
});

AppRegistry.registerComponent(appName, () => App);

// Initialize LiveKit RN WebRTC globals once at app start
registerGlobals();
