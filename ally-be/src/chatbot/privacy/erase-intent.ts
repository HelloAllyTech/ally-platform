import type { ReplyLanguage } from '../engine/reply-language';

/**
 * Erase in chat (R5): recognising the request and its two-step confirm. Pure, no I/O.
 *
 * Matching is deliberately narrow (a verb of erasing next to "my data / my chats / me"), so an
 * everyday question such as "how do I delete a booking?" is not mistaken for a request to erase
 * everything. A miss costs little: the person can ask again or ask the owner.
 */

const fold = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const EN = [
  /\b(delete|erase|remove|wipe|clear)\b.{0,20}\b(my|all my)\b.{0,15}\b(data|info|information|details|chats?|conversations?|messages?|history|memory)\b/,
  /\bforget (about )?me\b/,
  /\bforget everything (about me|i (told|said))\b/,
  /\b(delete|erase)\b.{0,10}\b(everything|all) (about me|you know about me)\b/,
];

const HI_LATN = [
  /\b(mera|meri|mere)\b.{0,15}\b(data|baatein|baatcheet|chat|messages?|jaankari|details)\b.{0,15}\b(delete|mita|mitao|mitaa|mitado|mita do|hata|hatao|hata do|clear)\b/,
  /\bmujhe bhool (jao|jaiye|jaana)\b/,
];

const HI = [
  /(मेरा|मेरी|मेरे).{0,20}(डेटा|डाटा|बातचीत|बातें|संदेश|मैसेज|जानकारी|विवरण).{0,20}(मिटा|हटा|डिलीट)/u,
  /मुझे भूल (जाओ|जाइए|जाएँ|जाएं)/u,
];

/**
 * Whether the message asks to erase the person's data. All patterns are tried whatever the
 * detected language (people mix scripts); `language` only orders them.
 */
export function isEraseRequest(
  text: string,
  language?: ReplyLanguage | string | null,
): boolean {
  const folded = fold(text ?? '');
  if (!folded || folded.length > 300) return false;
  const sets =
    language === 'hi'
      ? [HI, HI_LATN, EN]
      : language === 'hi-latn'
        ? [HI_LATN, EN, HI]
        : [EN, HI_LATN, HI];
  return sets.some((set) => set.some((re) => re.test(folded)));
}

const FORGET_NAME = [
  /\b(forget|delete|remove|erase|clear|don t use|stop using)\b.{0,10}\bmy name\b/,
  /\bmera naam\b.{0,10}\b(bhool|bhul|hata|hatao|hata do|mita|mitao|mita do|delete)\b/,
  /मेरा नाम.{0,10}(भूल|हटा|मिटा|डिलीट)/u,
];

/**
 * "Forget my name" (TF1 round 2, Saathi B-2): only the name goes, at once, with no confirm
 * question; "forget me" still erases everything after its confirm.
 */
export function isForgetNameRequest(text: string): boolean {
  const folded = fold(text ?? '');
  if (!folded || folded.length > 120) return false;
  return FORGET_NAME.some((re) => re.test(folded));
}

const YES =
  /^(yes|y|yes please|yes erase|erase|confirm|ok erase|haan|haa|han|ha|ji haan|haan ji|हाँ|हां|हा|जी हाँ|जी हां)$/u;
const NO = /^(no|n|cancel|stop|nahi|nahin|na|mat|नहीं|ना|मत)$/u;

/** How long a confirm question stays open. */
export const ERASE_CONFIRM_WINDOW_MS = 10 * 60_000;

export interface ErasePending {
  /** When the confirm question was asked (ISO). */
  askedAt: string;
}

export type EraseStep =
  /** Not about erasing: carry on as usual. */
  | { action: 'none'; pending: null }
  /** Ask the fixed confirm question and store `pending`. */
  | { action: 'ask_confirm'; pending: ErasePending }
  /** Confirmed: erase, then send the result message. */
  | { action: 'erase'; pending: null }
  /** Declined: say nothing was erased. */
  | { action: 'cancelled'; pending: null };

/**
 * The two-step confirm. With nothing pending, a request asks for confirmation; with a pending
 * question less than ten minutes old, a yes erases and a no cancels. Anything else clears the
 * pending question and carries on (an expired or ignored question is never acted on later).
 */
export function eraseConfirmStep(
  pending: ErasePending | null | undefined,
  text: string,
  language: ReplyLanguage | string | null | undefined,
  now: Date = new Date(),
): EraseStep {
  const folded = fold(text ?? '');
  const open =
    pending?.askedAt &&
    now.getTime() - new Date(pending.askedAt).getTime() <=
      ERASE_CONFIRM_WINDOW_MS &&
    now.getTime() >= new Date(pending.askedAt).getTime();
  if (open) {
    if (YES.test(folded)) return { action: 'erase', pending: null };
    if (NO.test(folded)) return { action: 'cancelled', pending: null };
  }
  if (isEraseRequest(text, language)) {
    return { action: 'ask_confirm', pending: { askedAt: now.toISOString() } };
  }
  return { action: 'none', pending: null };
}
