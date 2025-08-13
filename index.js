/**
 * @format
 */

import {registerGlobals} from '@livekit/react-native';
import {AppRegistry} from 'react-native';

import {name as appName} from './app.json';
import {App} from './src';

AppRegistry.registerComponent(appName, () => App);

// Initialize LiveKit RN WebRTC globals once at app start
registerGlobals();
