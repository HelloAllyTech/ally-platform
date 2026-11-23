import type { ReplyLanguage } from './reply-language';

/**
 * The three blocked states (section 3, "Blocked states"), named apart so a removed person never
 * looks like an abuse block and an empty budget never looks like either:
 *   - OUT_OF_CREDITS: no payer, the chatbot's budget is empty, the person passed a daily, weekly or
 *     monthly limit, or the usage feed has stopped. The fixed notification, no model call.
 *   - REMOVED_FROM_LIST: the sender is not (or no longer) on the chatbot's access list. The fixed
 *     notification plus a line that access is by invitation, no model call.
 *   - ABUSE_BLOCKED: the contact was blocked by the team. Silence (unchanged).
 *
 * In every state the free keyword crisis check runs first (R1): a match gets the crisis reply and
 * flags the conversation. STOP wins over all of them (the channel handles it before the engine).
 */
export type BlockedState =
  | 'OUT_OF_CREDITS'
  | 'REMOVED_FROM_LIST'
  | 'ABUSE_BLOCKED';

/** The default crisis information (R6): this link only, no specific numbers, no India defaults. */
export const FIND_A_HELPLINE_URL = 'https://findahelpline.com';

// COPY: needs approval (all strings below; R6 sign-off is still open in section 7 of the plan)
const CRISIS_INFO: Record<
  ReplyLanguage,
  { link: string; withNumbers: string }
> = {
  en: {
    link: `If you need support now, you can find a helpline near you at ${FIND_A_HELPLINE_URL}`,
    withNumbers: `If you need support now, call {numbers}, or find a helpline near you at ${FIND_A_HELPLINE_URL}`,
  },
  hi: {
    link: `अगर आपको अभी सहायता चाहिए, तो ${FIND_A_HELPLINE_URL} पर अपने पास की हेल्पलाइन खोजें`,
    withNumbers: `अगर आपको अभी सहायता चाहिए, तो {numbers} पर कॉल करें, या ${FIND_A_HELPLINE_URL} पर अपने पास की हेल्पलाइन खोजें`,
  },
  'hi-latn': {
    link: `Agar aapko abhi madad chahiye, to ${FIND_A_HELPLINE_URL} par apne paas ki helpline dhoondhein`,
    withNumbers: `Agar aapko abhi madad chahiye, to {numbers} par call karein, ya ${FIND_A_HELPLINE_URL} par apne paas ki helpline dhoondhein`,
  },
};

const LEAD: Record<
  Exclude<BlockedState, 'ABUSE_BLOCKED'>,
  Record<ReplyLanguage, string>
> = {
  OUT_OF_CREDITS: {
    en: "This assistant can't reply right now.",
    hi: 'यह सहायक अभी जवाब नहीं दे सकता।',
    'hi-latn': 'Yeh assistant abhi jawab nahi de sakta.',
  },
  REMOVED_FROM_LIST: {
    en: 'This assistant is available by invitation only.',
    hi: 'यह सहायक केवल आमंत्रण से उपलब्ध है।',
    'hi-latn': 'Yeh assistant sirf invitation se available hai.',
  },
};

/** The chatbot's crisis information: the builder's own numbers first when set, then the link. */
export function fixedCrisisInformation(
  ownNumbers: string | null | undefined,
  language: ReplyLanguage,
): string {
  const numbers = ownNumbers?.trim();
  const text = CRISIS_INFO[language] ?? CRISIS_INFO.en;
  return numbers ? text.withNumbers.replace('{numbers}', numbers) : text.link;
}

/** The fixed notification for a blocked state (no model call). Empty for ABUSE_BLOCKED. */
export function blockedNotice(
  state: BlockedState,
  options: { ownNumbers?: string | null; language: ReplyLanguage },
): string {
  if (state === 'ABUSE_BLOCKED') return '';
  const lead = LEAD[state][options.language] ?? LEAD[state].en;
  // No full stop after the link: some clients would make it part of the address.
  return `${lead} ${fixedCrisisInformation(options.ownNumbers, options.language)}`;
}

/** The owner's own test at a zero free balance (shown in the test pane, never to customers). */
// COPY: needs approval
export const OWNER_CREDITS_TEXT =
  'Your free balance is used up, so the test chatbot cannot answer. Contact Ally for more credits.';

/**
 * The owner's test pane text for a refused test turn, by the gate's real reason: a stopped usage
 * feed or a missing billing account is never called "out of credits". Customers never see these.
 */
// COPY: needs approval
export const OWNER_CREDITS_TEXTS = {
  out_of_credits: OWNER_CREDITS_TEXT,
  feed_off:
    'Usage tracking is temporarily unavailable, so the test chatbot cannot answer right now. It will work again automatically; try again in a few minutes.',
  no_payer:
    'This chatbot has no billing account yet, so the test chatbot cannot answer.',
  ledger_unavailable:
    'Credits could not be checked just now, so the test chatbot cannot answer. Try again in a few minutes.',
} as const;

export function ownerCreditsText(reason: string | null | undefined): string {
  switch (reason) {
    case 'feed_off':
    case 'no_payer':
    case 'ledger_unavailable':
      return OWNER_CREDITS_TEXTS[reason];
    default:
      return OWNER_CREDITS_TEXT;
  }
}
