import {
  FIND_A_HELPLINE_URL,
  fixedCrisisInformation,
} from '../engine/blocked-notice';
import { crisisHelplines } from '../engine/crisis-helplines';
import type { ReplyLanguage } from '../engine/reply-language';
import { ChatbotStatus } from '../enum/chatbot.enum';
import { safetySettingsOf } from './safety-settings';

/**
 * Stage 4: what a customer gets from a chatbot that is archived, or paused (by its team or by the
 * go-live gate, D10), on WhatsApp, the bot page and the widget: the owner's `archivedMessage` (or a
 * fixed default) and then the crisis information (R6), which the owner cannot remove. No model.
 */

// COPY: needs approval
export const DEFAULT_OFF_MESSAGE: Record<ReplyLanguage, string> = {
  en: "This assistant isn't available right now.",
  hi: 'यह सहायक अभी उपलब्ध नहीं है।',
  'hi-latn': 'Yeh assistant abhi available nahi hai.',
};

export type OffReason = 'archived' | 'paused';

/** Why a chatbot is off for customers, or null when it can answer. A draft is not "off". */
export function offReasonOf(chatbot: {
  status?: string | null;
  archivedAt?: Date | string | null;
}): OffReason | null {
  if (chatbot.archivedAt) return 'archived';
  if (chatbot.status === ChatbotStatus.PAUSED) return 'paused';
  return null;
}

export function offMessage(
  chatbot: { settings?: Record<string, unknown> | null },
  language: ReplyLanguage,
): string {
  const settings = chatbot.settings ?? {};
  const own = safetySettingsOf(settings as never).archivedMessage;
  const lead = own || DEFAULT_OFF_MESSAGE[language] || DEFAULT_OFF_MESSAGE.en;
  // Q4 G7: only numbers the owner confirmed.
  const numbers = crisisHelplines(settings as never) || null;
  const help = fixedCrisisInformation(numbers, language);
  // Locked: the crisis information always follows, unless the owner's words already carry it whole.
  return lead.includes(FIND_A_HELPLINE_URL) && lead.includes(help)
    ? lead
    : `${lead} ${help}`;
}
