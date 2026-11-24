/**
 * Wording for the staff Defaults page. Kept apart from `en.whatsappBot.bots.defaults` and from the
 * onboarding COPY object (copy.test.ts checks COPY against the approved copy doc).
 * The model: each chatbot gets its own copy of the starting settings and quick replies when it is
 * created; the platform defaults apply to chatbots that have not set their own; staff can push a
 * locked quick reply to every copy.
 */
export const DEFAULTS_COPY = {
  // COPY: needs approval
  intro:
    "Each chatbot gets its own copy of these starting settings and quick replies when it is created. Platform defaults apply to any chatbot that hasn't set its own value. Changing a default here doesn't overwrite what a chatbot has already set, except locked quick replies, which can be pushed to every chatbot's copy.",
  // COPY: needs approval
  repliesIntro:
    "Fixed replies that answer before the AI does, checked from top to bottom. A new chatbot starts with its own copy; it can reword them or add its own. Locked replies (crisis, STOP and HELP) can't be switched off and can be pushed to every copy.",
} as const;
