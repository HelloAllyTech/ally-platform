export const SESSION_BOOKMARKS_ANALYTICS_EVENTS = {
  /** A learner saved a roleplay session to return to later. */
  CREATED: 'roleplay.session_bookmarked',
  /** A learner removed a saved roleplay session. */
  REMOVED: 'roleplay.session_unbookmarked',
} as const;
