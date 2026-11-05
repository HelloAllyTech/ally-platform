import {Platform} from 'react-native';
import {PERMISSIONS} from 'react-native-permissions';

export enum USER_PERMISSIONS {
  // === CALL / CHAT ===
  VIEW_CALL_LOGS = 'view:call:logs',
  START_MICROPHONE_CHAT = 'start:microphone-chat',
  START_CLOUD_TELEPHONY_CHAT = 'start:cloud-telephony-chat',
  VIEW_CHAT_DETAILS = 'view:chat:details',
  EXPORT_CHAT_SUMMARY = 'export:chat:summary',
  VIEW_COUNSELOR_CHAT = 'view:chat:counselor',
  VIEW_MESSAGES = 'view:messages',
  ARCHIVE_CALL_LOG = 'archive:call-log',

  // === SUMMARY ===
  EDIT_SUMMARY = 'edit:summary',
  EDIT_SUMMARY_FEEDBACK = 'edit:summary:feedback',
  EDIT_MESSAGE_FEEDBACK = 'edit:message:feedback',

  // === SIMULATION / LEARN ===
  VIEW_SCENARIO_SESSION = 'view:scenario-session',
  VIEW_SCENARIO_SESSION_DETAILS = 'view:scenario-session:details',
  EDIT_SCENARIO_SESSION = 'edit:scenario-session',
  VIEW_SESSION_SCENARIO_MESSAGES = 'view:session-scenario:messages',

  // === SIMULATION REVIEW ===
  VIEW_SIMULATION_REVIEW = 'view:simulation-review',
  EDIT_SIMULATION_REVIEW = 'edit:simulation-review',
  VIEW_SIMULATION_REVIEWS = 'view:simulation-reviews',
  VIEW_SIMULATION_REVIEW_THREADS = 'view:simulation-review-threads',
  EDIT_SIMULATION_REVIEW_THREAD = 'edit:simulation-review-thread',

  // === SCRIBE REVIEW ===
  VIEW_SCRIBE_REVIEW = 'view:scribe-review',
  EDIT_SCRIBE_REVIEW = 'edit:scribe-review',
  VIEW_SCRIBE_REVIEWS = 'view:scribe-reviews',
  VIEW_SCRIBE_REVIEW_THREADS = 'view:scribe-review-threads',
  EDIT_SCRIBE_REVIEW_THREAD = 'edit:scribe-review-thread',

  // === ANALYTICS ===
  VIEW_ANALYTICS_DASHBOARD = 'view:analytics:dashboard',

  // === REFERENCE / SEARCH ===
  VIEW_REFERENCE_DOCUMENT = 'view:reference-document',

  // === COMMUNITY ===
  VIEW_COMMUNITY = 'view:community',
  VIEW_COMMUNITY_LEADERBOARD = 'view:community:leaderboard',
  // Personal engagement data — the streak, rank and progress surfaces all carry it.
  VIEW_USER_RANK = 'view:user:rank',

  // === BADGES ===
  VIEW_USER_BADGES = 'view:user:badges',
  EDIT_USER_BADGES = 'edit:user:badges',

  // === CUSTOM FIELDS ===
  MANAGE_CUSTOM_FIELD_DEFINITIONS = 'manage:custom-field:definitions',

  // === COUNSELLOR ===
  COUNSELOR_ACCESS = 'counselor:access',

  // === EVALUATION ===
  // Held only by the EVALUATOR role, which is layered on top of a normal app
  // role. Gates the extra evaluation questions and nothing else, so it can
  // never be the reason an account reaches something it otherwise could not.
  EVALUATOR_ACCESS = 'evaluator:access',
}

export const MICROPHONE_PERMISSION =
  Platform.OS === 'ios'
    ? PERMISSIONS.IOS.MICROPHONE
    : PERMISSIONS.ANDROID.RECORD_AUDIO;
