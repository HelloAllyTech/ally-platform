import type { ReplyLanguage } from './reply-language';

/**
 * Why a message got no run (CR1 enforcement). The crisis check has already run for it, and a crisis
 * reply would have gone out instead.
 */
export type LimitReason =
  /** A public or WhatsApp customer: the creator's monthly cost cap is reached, or this assistant's monthly customer conversations are used up. */
  | 'customers'
  /** An invited person with no seat, or whose seat lapsed. */
  | 'no_seat'
  /** An invited person who used this month's messages on their seat. */
  | 'seat_messages'
  /** The owner or their team (Try it): the creator's monthly cost cap is reached. */
  | 'owner_cap'
  /** The owner or their team (Try it): the plan's monthly owner-side runs are used up. */
  | 'owner_runs';

/**
 * Fixed, honest replies, in the person's language like the run-failed reply (no AI call). Never a
 * dollar or a plan price: customers and owners don't see those.
 */
const TEXT: Record<LimitReason, Record<ReplyLanguage, string>> = {
  customers: {
    en: "This assistant isn't available right now. Please contact {business}: {contact}.",
    hi: 'यह सहायक अभी उपलब्ध नहीं है। कृपया {business} से संपर्क करें: {contact}।',
    'hi-latn':
      'Yeh assistant abhi available nahi hai. Please {business} se contact karein: {contact}.',
  },
  no_seat: {
    en: "You don't have a seat on this assistant. Ask {owner} for a seat.",
    hi: 'इस सहायक पर आपकी सीट नहीं है। {owner} से सीट के लिए कहें।',
    'hi-latn':
      'Is assistant par aapki seat nahi hai. {owner} se seat ke liye kahein.',
  },
  seat_messages: {
    en: "You've reached this month's messages. Ask {owner} for a Premium seat.",
    hi: 'आपने इस महीने के संदेश पूरे कर लिए हैं। Premium सीट के लिए {owner} से कहें।',
    'hi-latn':
      'Aapne is mahine ke messages poore kar liye hain. Premium seat ke liye {owner} se kahein.',
  },
  owner_cap: {
    en: "Your account has reached this month's usage limit. Ask Ally to raise it.",
    hi: 'आपके खाते की इस महीने की उपयोग सीमा पूरी हो गई है। इसे बढ़ाने के लिए Ally से कहें।',
    'hi-latn':
      'Aapke account ki is mahine ki usage limit poori ho gayi hai. Ise badhane ke liye Ally se kahein.',
  },
  owner_runs: {
    en: "Your plan's monthly limit for setup and checkups is used up. Ask Ally to upgrade.",
    hi: 'सेटअप और चेकअप के लिए आपके प्लान की मासिक सीमा पूरी हो गई है। अपग्रेड के लिए Ally से कहें।',
    'hi-latn':
      'Setup aur checkups ke liye aapke plan ki monthly limit poori ho gayi hai. Upgrade ke liye Ally se kahein.',
  },
};

/** The customer reply with no contact in the sources: no dangling colon. */
const CUSTOMERS_NO_CONTACT: Record<ReplyLanguage, string> = {
  en: "This assistant isn't available right now. Please contact {business} directly.",
  hi: 'यह सहायक अभी उपलब्ध नहीं है। कृपया सीधे {business} से संपर्क करें।',
  'hi-latn':
    'Yeh assistant abhi available nahi hai. Please seedhe {business} se contact karein.',
};

export function limitReply(
  reason: LimitReason,
  language: ReplyLanguage,
  names: {
    business?: string | null;
    contact?: string | null;
    owner?: string | null;
  },
): string {
  const business = names.business?.trim() || 'the business';
  const owner = names.owner?.trim() || 'the assistant’s owner';
  const template =
    reason === 'customers' && !names.contact
      ? CUSTOMERS_NO_CONTACT[language]
      : TEXT[reason][language];
  return template
    .replace('{business}', business)
    .replace('{contact}', names.contact ?? '')
    .replace('{owner}', owner);
}

/** Owner-side refusals outside a chat (setup, checkups, change by chat, re-indexing), as API errors. */
export const OWNER_LIMIT_MESSAGES = {
  owner_cap: TEXT.owner_cap.en,
  owner_runs: TEXT.owner_runs.en,
} as const;
