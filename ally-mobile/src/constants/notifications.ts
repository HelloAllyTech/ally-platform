/** Server-sent engagement reminders (FCM → Notifee) — distinct from the
 * local weekly leaderboard notification in `leaderboard.ts`. */
export const REMINDERS_CHANNEL_ID = 'reminders';
export const REMINDER_NOTIFICATION_TYPE = 'ENGAGEMENT_REMINDER';

/** In-app feed item for a reply to the learner's own course discussion post. */
export const COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE =
  'COURSE_DISCUSSION_REPLY';

/** The learner's debrief is ready, or was changed after a review by the Ally
 * team. Both carry `scenarioSessionId` and open that session's debrief. */
export const DEBRIEF_READY_NOTIFICATION_TYPE = 'DEBRIEF_READY';
export const DEBRIEF_REVIEWED_NOTIFICATION_TYPE = 'DEBRIEF_REVIEWED';
export const DEBRIEF_NOTIFICATION_TYPES: readonly string[] = [
  DEBRIEF_READY_NOTIFICATION_TYPE,
  DEBRIEF_REVIEWED_NOTIFICATION_TYPE,
];
