export const SCREEN_NAMES = {
  // Root Stack Screens
  SPLASH: 'Splash',
  HOME: 'Home',
  LISTENING: 'Listening',
  CALL_SUMMARY: 'CallSummary',
  CALL_LOG: 'CallLog',
  BREATHING: 'Breathing',
  LIVE_KIT_TEST: 'LiveKitTest',
  SIMULATIONS: 'Simulations',
  SIMULATION_DETAILS: 'SimulationDetails',
  SIMULATION_ASSISTANT: 'SimulationAssistant',
  SIMULATION_FEEDBACK: 'SimulationFeedback',

  // Tab Screens
  HOME_TAB: 'HomeTab',
  COMMUNITY: 'Community',
  USER_ANALYTICS: 'UserAnalytics',
  SEARCH: 'Search',
  LEARN: 'Learn',

  // Drawer Screens
  BOTTOM_TABS: 'BottomTabs',
} as const;

export type ScreenNames = (typeof SCREEN_NAMES)[keyof typeof SCREEN_NAMES];
