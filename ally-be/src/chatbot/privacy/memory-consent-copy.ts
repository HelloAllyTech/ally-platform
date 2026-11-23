import type { ReplyLanguage } from '../engine/reply-language';
import type { AudienceAge } from '../safety/safety-settings';

/**
 * The memory consent question (D7): one question, the same step for everyone, worded by the
 * chatbot's stated audience age. An unstated age gets the young-people wording (the strictest
 * default covers wording too). The version is stored with each answer, so a change of wording
 * can be told apart from the answers given to the old one.
 */
export const CONSENT_WORDING_VERSION = {
  adults: 'memory-consent-adults-v1',
  young: 'memory-consent-young-v1',
} as const;

// COPY: needs approval
const ADULTS: Record<ReplyLanguage, string> = {
  en: 'Can I remember things you tell me, such as your preferences, to help you next time? You can ask me to forget them at any time. Reply YES or NO.',
  hi: 'क्या मैं आपकी बताई बातें, जैसे आपकी पसंद, याद रख सकता हूँ ताकि अगली बार आपकी मदद कर सकूँ? आप कभी भी उन्हें भूलने के लिए कह सकते हैं। हाँ या नहीं लिखें।',
  'hi-latn':
    'Kya main aapki batayi baatein, jaise aapki pasand, yaad rakh sakta hoon taaki agli baar aapki madad kar sakoon? Aap kabhi bhi unhe bhoolne ke liye keh sakte hain. HAAN ya NAHIN likhein.',
};

// COPY: needs approval
const YOUNG: Record<ReplyLanguage, string> = {
  en: 'Is it OK if I remember a few things you tell me, so I can help you better next time? You can say no, and you can ask me to forget at any time. Reply YES or NO.',
  hi: 'क्या यह ठीक है अगर मैं आपकी बताई कुछ बातें याद रखूँ, ताकि अगली बार बेहतर मदद कर सकूँ? आप मना कर सकते हैं, और कभी भी भूलने के लिए कह सकते हैं। हाँ या नहीं लिखें।',
  'hi-latn':
    'Kya yeh theek hai agar main aapki batayi kuch baatein yaad rakhoon, taaki agli baar behtar madad kar sakoon? Aap mana kar sakte hain, aur kabhi bhi bhoolne ke liye keh sakte hain. HAAN ya NAHIN likhein.',
};

export function consentWording(
  audienceAge: AudienceAge | null | undefined,
  language: ReplyLanguage,
): { text: string; version: string } {
  return audienceAge === 'adults'
    ? { text: ADULTS[language], version: CONSENT_WORDING_VERSION.adults }
    : { text: YOUNG[language], version: CONSENT_WORDING_VERSION.young };
}

const YES =
  /^(yes|y|ok|okay|sure|yes please|haan|haa|han|ha|ji|ji haan|theek hai|हाँ|हां|जी|जी हाँ|ठीक है)$/u;
const NO = /^(no|n|no thanks|nahi|nahin|na|mat|नहीं|ना|मत)$/u;

/** A YES/NO answer to the consent question, or null when the message is something else. */
export function consentAnswerOf(text: string): 'granted' | 'declined' | null {
  const folded = (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (YES.test(folded)) return 'granted';
  if (NO.test(folded)) return 'declined';
  return null;
}
