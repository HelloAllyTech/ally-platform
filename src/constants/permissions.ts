import {Platform} from 'react-native';
import {PERMISSIONS} from 'react-native-permissions';

export enum USER_PERMISSIONS {
  VIEW_CALL_LOGS = 'view:call:logs',
  VIEW_NAVBAR_CALENDAR = 'view:navbar:calendar',
  VIEW_NAVBAR_LEARN = 'view:navbar:learn',
  VIEW_NAVBAR_STRESS_BUSTER = 'view:navbar:stress-buster',
  VIEW_NAVBAR_SETTINGS = 'view:navbar:settings',
  EDIT_SUMMARY = 'edit:summary',
  VIEW_REFERENCE_DOCUMENT = 'view:reference-document',
  VIEW_NAVBAR_COMMUNITY = 'view:navbar:community',
  VIEW_SCENARIO_SESSION = 'view:scenario-session',
  VIEW_ADMIN_SCENARIO_SESSION = 'view:admin:scenario-session',
  VIEW_ANALYTICS_DASHBOARD = 'view:analytics:dashboard',
  START_MICROPHONE_CHAT = 'start:microphone-chat',
  START_CLOUD_TELEPHONY_CHAT = 'start:cloud-telephony-chat',
}

export const MICROPHONE_PERMISSION =
  Platform.OS === 'ios'
    ? PERMISSIONS.IOS.MICROPHONE
    : PERMISSIONS.ANDROID.RECORD_AUDIO;
