/** Server-sent engagement reminders (FCM → Notifee) — distinct from the
 * local weekly leaderboard notification in `leaderboard.ts`. */
export const REMINDERS_CHANNEL_ID = 'reminders';
export const REMINDER_NOTIFICATION_TYPE = 'ENGAGEMENT_REMINDER';

/** In-app feed item for a reply to the learner's own course discussion post. */
export const COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE =
  'COURSE_DISCUSSION_REPLY';
