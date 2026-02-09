import {Platform} from 'react-native';
import {PERMISSIONS} from 'react-native-permissions';

export enum USER_PERMISSIONS {
  VIEW_CALL_LOGS = 'view:call:logs',
  EDIT_SUMMARY = 'edit:summary',
  VIEW_REFERENCE_DOCUMENT = 'view:reference-document',
  VIEW_COMMUNITY = 'view:community',
  VIEW_SCENARIO_SESSION = 'view:scenario-session',
  VIEW_ANALYTICS_DASHBOARD = 'view:analytics:dashboard',
  START_MICROPHONE_CHAT = 'start:microphone-chat',
  START_CLOUD_TELEPHONY_CHAT = 'start:cloud-telephony-chat',
  VIEW_CHAT_DETAILS = 'view:chat:details',
  EXPORT_CHAT_SUMMARY = 'export:chat:summary',
  EDIT_SUMMARY_FEEDBACK = 'edit:summary:feedback',
  VIEW_SCENARIO_SESSION_DETAILS = 'view:scenario-session:details',
  EDIT_SCENARIO_SESSION = 'edit:scenario-session',
  VIEW_SESSION_SCENARIO_MESSAGES = 'view:session-scenario:messages',
  VIEW_COUNSELOR_CHAT = 'view:chat:counselor',
  VIEW_MESSAGES = 'view:messages',
  EDIT_MESSAGE_FEEDBACK = 'edit:message:feedback',
  VIEW_REVIEWS = 'view:reviews',
  EDIT_REVIEW = 'edit:review',
  VIEW_COMMUNITY_LEADERBOARD = 'view:community:leaderboard',
  VIEW_USER_BADGES = 'view:user:badges',
  EDIT_USER_BADGES = 'edit:user:badges',
}

export const MICROPHONE_PERMISSION =
  Platform.OS === 'ios'
    ? PERMISSIONS.IOS.MICROPHONE
    : PERMISSIONS.ANDROID.RECORD_AUDIO;
