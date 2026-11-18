/**
 * The visitor's "Was this helpful?" rating (chunk Q2a; Q3d). A thumbs down arrives twice: bare on
 * the tap, then with "What was wrong?" and the note, and the two requests aren't ordered. So a
 * bare thumbs down keeps the reason and note already stored (prod, 18 Nov: the owner saw
 * neither), a repeat that says nothing new doesn't reopen an item the owner handled, and a thumbs
 * up clears them.
 */

/**
 * Whether a repeat rating says something new: another thumb, or a reason or note it didn't have.
 * Only then does a handled item open again.
 */
const FEEDBACK_CHANGED = `(f.rating IS DISTINCT FROM EXCLUDED.rating
  OR (EXCLUDED.reason IS NOT NULL AND EXCLUDED.reason IS DISTINCT FROM f.reason)
  OR (EXCLUDED.note IS NOT NULL AND EXCLUDED.note IS DISTINCT FROM f.note))`;

/** Stores a visitor's rating (`$1`–`$6`: message, chatbot, conversation, rating, reason, note). */
export const FEEDBACK_UPSERT = `INSERT INTO chatbot_message_feedback AS f
     (message_id, chatbot_id, conversation_id, rating, reason, note, status)
   VALUES ($1, $2, $3, $4, $5, $6, 'open')
   ON CONFLICT (message_id) DO UPDATE SET
     rating = EXCLUDED.rating,
     reason = CASE WHEN EXCLUDED.rating = 'down'
       THEN COALESCE(EXCLUDED.reason, f.reason) END,
     note = CASE WHEN EXCLUDED.rating = 'down'
       THEN COALESCE(EXCLUDED.note, f.note) END,
     status = CASE WHEN ${FEEDBACK_CHANGED} THEN 'open' ELSE f.status END,
     handled_by = CASE WHEN ${FEEDBACK_CHANGED} THEN NULL ELSE f.handled_by END,
     handled_at = CASE WHEN ${FEEDBACK_CHANGED} THEN NULL ELSE f.handled_at END,
     "updatedAt" = now()`;
