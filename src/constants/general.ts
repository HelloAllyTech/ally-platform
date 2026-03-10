import {Dimensions, Platform} from 'react-native';
import {ms} from 'react-native-size-matters';

import {carousel1, carousel2, carousel3, carousel4} from '@/assets';
import {CarouselItem} from '@/components';
import {CarouselConfig} from '@/components/Carousel/types';
import {colors, fontFamily, typography} from '@/theme';
import {UserRole} from '@/types';

import {USER_PERMISSIONS} from './permissions';

export const MICROPHONE_AUDIO_SAMPLE_RATE = 16000;
export const MINUTES_IN_MS = 60 * 1000;
export const MINUTES_IN_SECONDS = 60;
export const SECONDS_IN_MS = 1000;

export const DEFAULT_HIT_SLOP = {
  top: 10,
  bottom: 10,
  left: 10,
  right: 10,
};

export const SCREEN_WIDTH = Dimensions.get('window').width;
export const WINDOW_HEIGHT = Dimensions.get('window').height;
export const DEFAULT_OTP_EXPIRY_MINUTES = 10;
export const RESEND_COUNTDOWN_SECONDS = 1 * MINUTES_IN_SECONDS;
export const MB_IN_BYTES = 1024 * 1024;
export const MAX_PROFILE_IMAGE_SIZE = 2 * MB_IN_BYTES;

export const isIOS = Platform.OS === 'ios';

export enum APIVersion {
  V1 = 'v1',
  V2 = 'v2',
}

export enum LanguageCode {
  EN = 'en',
}

export const TAG_COLORS = {
  1: {bg: '#FEE1E180', text: '#C62828'},
  2: {bg: '#FFE8D580', text: '#F55A00'},
  3: {bg: '#EBEBEB80', text: '#424242'},
  4: {bg: '#D7F4DC80', text: '#388E3C'},
  5: {bg: '#B9EFC880', text: '#1B5E20'},
};

export const ALLOWED_ROLES = [
  UserRole.COUNSELOR,
  UserRole.LEARNER,
  UserRole.SIMULATION_REVIEWER,
  UserRole.SCRIBE_REVIEWER,
];

export enum AllyPlatforms {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

export enum LogType {
  REAL = 'real',
  SIMULATION = 'simulation',
  ARCHIVED_REAL = 'archived_real',
}

export enum LanguageMap {
  bn = 'Bengali',
  en = 'English',
  gu = 'Gujarati',
  hi = 'Hindi',
  kn = 'Kannada',
  ml = 'Malayalam',
  or = 'Oriya',
  pa = 'Punjabi',
  ta = 'Tamil',
  te = 'Telugu',
}

// API route constants
export const API_ROUTES = {
  AUTH: {
    REFRESH: '/auth/refresh',
    GENERATE_OTP: '/auth/generate-otp',
    VERIFY_OTP: '/auth/verify-otp',
    GOOGLE_LOGIN: '/auth/google',
    PERMISSIONS: '/authorization/permissions',
  },
  USERS: {
    ME: '/users/me',
    PROFILE_IMAGE_URL: '/users/profile-image-url',
    PROFILE_IMAGE: '/users/profile-image',
    LOGO_URL: '/users/tenant',
    UPDATE_USER_PREFERENCES: '/users/preferences',
    GET_USER_PREFERENCES: '/users/me/preferences',
  },
  CHATS: {
    ROOT: '/chats',
    COUNSELLOR_CHAT: '/chats/counsellor-chat',
    BY_ID: (chatId: number) => `/chats/${chatId}`,
    END: (chatId: number) => `/chats/${chatId}/end`,
    NOTES: (chatId: number) => `/chats/${chatId}/notes`,
    MESSAGES: (chatId: number) => `/chats/${chatId}/messages`,
    CALL_DETAILS: (chatId: number) => `/chats/${chatId}/call-details`,
    EXPORT_SUMMARY: (chatId: number) => `/chats/${chatId}/export-summary`,
    CALL_INFO: (chatId: number) => `/chats/${chatId}/call-info`,
    SUMMARY_FEEDBACK: (chatId: number) => `/chats/${chatId}/summary-feedback`,
    ENHANCE: '/chats/enhance',
    CALL_LOGS: '/chats/call-logs',
    SUMMARY_TAG_RATINGS: '/chats/summary/tag-positivity-ratings',
    MESSAGES_FEEDBACK: (chatId: number) => `/chats/messages/${chatId}/feedback`,
    MESSAGES_FEEDBACK_BY_ID: (feedbackId: number) =>
      `/chats/messages/feedback/${feedbackId}`,
    ARCHIVE_CALL_LOG: (callLogId: number) =>
      `/chats/call-logs/${callLogId}/archive`,
  },
  ANALYTICS: {
    DASHBOARD: '/analytics/dashboard',
    DASHBOARD_BY_ID: (dashboardId: string) =>
      `/analytics/dashboard/${dashboardId}`,
  },
  REFERENCE_DOCUMENT: {
    SEARCH: '/reference-document/search',
    CATEGORIES: '/reference-document/categories',
  },
  PLACES: {
    ROOT: '/places',
    SEARCH: '/places/search',
  },
  SETTINGS: {
    SUMMARY_FIELDS: '/settings/summary-fields',
    NUDGE_STATUS: '/settings/nudge-status',
    CHAT_TYPES: '/settings/chat-types',
  },
  LEARN: {
    ROOMS: '/rooms',
    ROOM_BY_ID: (roomId: number) => `/rooms/${roomId}`,
    SCENARIO_SESSION_FEEDBACK: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/feedback`,
    SCENARIOS: '/learn/scenarios',
    SCENARIO_BY_ID: (id: string) => `/learn/scenarios/${id}`,
    SIMULATION_DETAILS: (id: string) => `/learn/scenario-session/${id}`,
    SCENARIO_SESSION_START: '/learn/scenario-session-start',
    END_SCENARIO_SESSION: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/end`,
    SIMULATION_LOGS: '/learn/scenario-sessions',
    SIMULATION_MESSAGES: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/messages`,
    SIMULATION_CREDITS: '/simulation-credits',
    SCENARIO_PATHS: '/learn/scenario-paths',
    CREATE_PATH_SESSION: (pathId: string) =>
      `/learn/scenario-paths/${pathId}/create-session`,
    SIMULATION_PATH_DETAILS: (pathId: string) =>
      `/learn/scenario-paths/${pathId}`,
    UPCOMING_PATH_SCENARIO: (scenarioPathSessionId: string) =>
      `/learn/scenario-paths/${scenarioPathSessionId}/upcoming-scenario`,
    SCENARIO_SESSION_BY_PATH_ITEM: (pathSessionItemId: string) =>
      `/learn/scenario-session/scenario-path-session-item/${pathSessionItemId}`,
    GET_AVAILABLE_LANGUAGES: '/learn/scenario-languages',
    CASES: '/learn/cases',
    CASE_DETAILS: (caseId: string) => `/learn/cases/${caseId}`,
    CREATE_CASE_SESSION: (caseId: string) =>
      `/learn/cases/${caseId}/create-session`,
    UPCOMING_CASE_SCENARIO: (scenarioSessionId: string) =>
      `/learn/cases/${scenarioSessionId}/upcoming-scenario`,
    SCENARIO_SESSION_BY_CASE_ITEM: (caseSessionItemId: string) =>
      `/learn/scenario-session/case-session-item/${caseSessionItemId}`,
    CHAT_STREAM: (scenarioSessionId: string) =>
      `/learn/scenario-sessions/${scenarioSessionId}/chat/stream`,
    CHAT_HISTORY: (scenarioSessionId: string) =>
      `/learn/scenario-sessions/${scenarioSessionId}/chat/history`,
    EVENT_CHECKLIST: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/event-checklist`,
    REFLECTION_PROMPTS: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/reflection-prompts`,
    REFLECTION_PROMPT_BY_ID: (
      scenarioSessionId: string,
      reflectionPromptId: string,
    ) =>
      `/learn/scenario-session/${scenarioSessionId}/reflection-prompts/${reflectionPromptId}`,
  },
  REVIEWS: {
    REVIEWS: '/reviews',
    CREATE_REVIEW: '/reviews',
    GET_REVIEW: (reviewId: string) => `/reviews/${reviewId}`,
    REVIEW_BY_ID: (reviewId: string) => `/reviews/${reviewId}`,
    UPDATE_REVIEW_STATUS: (reviewId: string) => `/reviews/${reviewId}`,
    ADD_REVIEW_COMMENT: (reviewId: string) => `/reviews/${reviewId}/comments`,
    GET_GENERAL_REVIEW_COMMENTS: (reviewId: string) =>
      `/reviews/${reviewId}/comments`,
    GET_MESSAGES: (reviewId: string) => `/reviews/${reviewId}/messages`,
    REACTIONS: (reviewId: string | number) => `/reviews/${reviewId}/reactions`,
    REACTIONS_COUNT: (reviewId: string | number) =>
      `/reviews/${reviewId}/reactions/count`,
    THREADS: (reviewId: string | number) => `/reviews/${reviewId}/threads`,
    GET_THREAD_COMMENTS: (threadId: string) =>
      `/reviews/threads/${threadId}/comments`,
    GET_COMMENT_REPLIES: (commentId: string) =>
      `/reviews/comments/${commentId}/replies`,
    UPDATE_COMMENT_VISIBILITY: (commentId: string) =>
      `/reviews/comments/${commentId}/visibility`,
    UPDATE_COMMENT: (commentId: string) => `/reviews/comments/${commentId}`,
    DELETE_COMMENT: (commentId: string) => `/reviews/comments/${commentId}`,
    ADD_REACTION_TO_COMMENT: (commentId: string) =>
      `/reviews/comments/${commentId}/reactions`,
    ADD_REACTION_TO_REVIEW: (reviewId: string) =>
      `/reviews/${reviewId}/reactions`,
  },
  // TODO: Update scribe URL patterns once backend confirms exact paths
  SCRIBE_REVIEWS: {
    REVIEW_BY_ID: (reviewId: string) => `/scribe/${reviewId}`,
    ADD_REVIEW_COMMENT: (reviewId: string) => `/scribe/${reviewId}/comments`,
    GET_GENERAL_REVIEW_COMMENTS: (reviewId: string) =>
      `/scribe/${reviewId}/comments`,
    GET_MESSAGES: (reviewId: string) => `/scribe/${reviewId}/messages`,
    REACTIONS: (reviewId: string | number) => `/scribe/${reviewId}/reactions`,
    REACTIONS_COUNT: (reviewId: string | number) =>
      `/scribe/${reviewId}/reactions/count`,
    THREADS: (reviewId: string | number) => `/scribe/${reviewId}/threads`,
    GET_THREAD_COMMENTS: (threadId: string) =>
      `/scribe/threads/${threadId}/comments`,
    GET_COMMENT_REPLIES: (commentId: string) =>
      `/scribe/comments/${commentId}/replies`,
    UPDATE_COMMENT_VISIBILITY: (commentId: string) =>
      `/scribe/comments/${commentId}/visibility`,
    UPDATE_COMMENT: (commentId: string) => `/scribe/comments/${commentId}`,
    DELETE_COMMENT: (commentId: string) => `/scribe/comments/${commentId}`,
    ADD_REACTION_TO_COMMENT: (commentId: string) =>
      `/scribe/comments/${commentId}/reactions`,
    ADD_REACTION_TO_REVIEW: (reviewId: string) =>
      `/scribe/${reviewId}/reactions`,
    GENERAL_COMMENTS: (reviewId: string) =>
      `/scribe/${reviewId}/general-comments`,
    GENERAL_COMMENT_BY_ID: (commentId: string) =>
      `/scribe/general-comments/${commentId}`,
    GENERAL_COMMENT_VISIBILITY: (commentId: string) =>
      `/scribe/general-comments/${commentId}/visibility`,
  },
  BADGES: {
    GET_BADGES: `/badges/me`,
    AVAILABLE: '/badges/me/available',
    GET_BADGE_COUNT: '/badges/me/count',
    MARK_BADGE_AS_VIEWED: (badgeId: string) => `/badges/me/${badgeId}/viewed`,
  },
  COMMUNITY: {
    LEADERBOARD: '/community/leaderboard',
    MY_RANK: '/community/leaderboard/my-rank',
  },
  SIMULATION_SUMMARY: {
    GET_SKILLS: (scenarioSessionId: string) =>
      `/learn/scenario-session/${scenarioSessionId}/skills`,
  },
  APP_VERSION: {
    ANDROID: '/app-version/android',
    IOS: '/app-version/ios',
  },
} as const;

export const API_METHODS = {
  GET: 'GET',
  POST: 'POST',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  PUT: 'PUT',
} as const;

export const TERMS_AND_CONDITIONS_URL = 'https://helloally.ai/terms';
export const PRIVACY_POLICY_URL = 'https://helloally.ai/policy';

export const SIMULATION_START_NOTIFICATION = {
  TITLE: 'Before you get started',
  DESCRIPTION:
    'At times, the bot may be unresponsive, or have unusual lag times. We are always working to improve the experience!',
  START_SESSION: 'Start Session',
};

export const SECURITY_CAROUSEL_SLIDES: CarouselItem[] = [
  {image: carousel1, textKey: 'Carousel.slide1'},
  {image: carousel2, textKey: 'Carousel.slide2'},
  {image: carousel3, textKey: 'Carousel.slide3'},
  {image: carousel4, textKey: 'Carousel.slide4'},
];

export enum CarouselVariant {
  DRAWER = 'drawer',
  DEFAULT = 'default',
}

export const drawerSecurityCarouselConfig: CarouselConfig = {
  width: SCREEN_WIDTH - 80,
  isBlurView: false,
  paginationActiveDotStyle: {
    backgroundColor: colors.black,
  },
  imageContainerCustomStyle: {
    width: '90%',
    height: ms(250),
    padding: 4,
    borderRightWidth: 1,
    borderLeftWidth: 1,
  },
  titleCustomStyle: {
    color: colors.ds.typography.highEmphasis,
    ...typography.headline.tiny,
  },
};

export const defaultSecurityCarouselConfig: CarouselConfig = {
  width: SCREEN_WIDTH,
  isBlurView: true,
  paginationActiveDotStyle: {
    backgroundColor: colors.white,
  },
  imageContainerCustomStyle: {
    borderWidth: 0,
    borderRightWidth: 0,
    borderLeftWidth: 0,
    overflow: 'hidden',
  },
  titleCustomStyle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.charcoal2,
    ...typography.headline.tiny,
  },
};

export const APP_STORE_URLS = {
  ios: 'https://apps.apple.com/app/helloally/id6745545012',
  android: 'https://play.google.com/store/apps/details?id=com.helloally.app',
};

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum KeyCode {
  Backspace = 'Backspace',
  Enter = 'Enter',
  Return = 'Return',
}

export const START_CALL_PERMISSIONS = [
  USER_PERMISSIONS.START_MICROPHONE_CHAT,
  USER_PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
];

// Permissions for all bottom navigation tabs
export const TAB_PERMISSIONS = [
  USER_PERMISSIONS.VIEW_CALL_LOGS, // CallLog tab - Real calls
  USER_PERMISSIONS.VIEW_SCENARIO_SESSION, // CallLog tab - Simulations
  USER_PERMISSIONS.EDIT_SCENARIO_SESSION, // Learn tab
  USER_PERMISSIONS.VIEW_SIMULATION_REVIEWS, // Simulation review tab
  USER_PERMISSIONS.VIEW_SCRIBE_REVIEWS, // Scribe review tab
  USER_PERMISSIONS.VIEW_ANALYTICS_DASHBOARD, // User Analytics tab
  USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD, // Leaderboard tab
  USER_PERMISSIONS.VIEW_REFERENCE_DOCUMENT, // Search tab
  USER_PERMISSIONS.VIEW_COMMUNITY, // Community tab
];

export enum ErrorCode {
  USER_SUSPENDED = 'USER_SUSPENDED',
}

export const EDIT_COMMENT_TIME_LIMIT_MINUTES = 10;
