export const SCREEN_NAMES = {
  // Root Stack Screens
  SPLASH: 'Splash',
  SUSPENDED_ACCOUNT: 'SuspendedAccount',
  HOME: 'Home',
  LISTENING: 'Listening',
  CALL_SUMMARY: 'CallSummary',
  CALL_LOG: 'CallLog',
  BREATHING: 'Breathing',
  LIVE_KIT_TEST: 'LiveKitTest',
  SIMULATIONS: 'Simulations',
  SIMULATION_DETAILS: 'SimulationDetails',
  SIMULATION_PATH_DETAILS: 'SimulationPathDetails',
  CASE_DETAILS: 'CaseDetails',
  SIMULATION_ASSISTANT: 'SimulationAssistant',
  SIMULATION_FEEDBACK: 'SimulationFeedback',
  ACHIEVEMENTS: 'Achievements',
  PROFILE_SETTINGS: 'ProfileSettings',
  REVIEW_DETAILS: 'ReviewDetails',

  REACTIONS: 'Reactions',
  // Tab Screens
  HOME_TAB: 'HomeTab',
  COMMUNITY: 'Community',
  USER_ANALYTICS: 'UserAnalytics',
  SEARCH: 'Search',
  LEARN: 'Learn',
  LEADERBOARD: 'Leaderboard',
  REVIEW: 'Review',

  // Drawer Screens
  BOTTOM_TABS: 'BottomTabs',
} as const;

export type ScreenNames = (typeof SCREEN_NAMES)[keyof typeof SCREEN_NAMES];
