import type { ReplyLanguage } from '../engine/reply-language';
import { helpLine } from '../safety/crisis-copy';
import type { NoAnswerMode } from '../safety/safety-settings';

/**
 * The default reply when the assistant has no answer (stage 5, the no-answer setting), composed
 * from fixed parts by the chatbot's `noAnswerMode`: say it does not know, offer a person, or
 * both. The crisis information (R6: the builder's numbers first, then the findahelpline.com link)
 * is always the last line. Fixed texts in English, Hindi and Hindi in Latin script. Pure.
 */

// COPY: needs approval
const UNKNOWN: Record<ReplyLanguage, string> = {
  en: "I don't know the answer to that.",
  hi: 'मुझे इसका जवाब नहीं पता।',
  'hi-latn': 'Mujhe iska jawab nahin pata.',
};

// COPY: needs approval
const PERSON: Record<ReplyLanguage, string> = {
  en: 'If you would like, I can ask a person from the team to reply.',
  hi: 'अगर आप चाहें, तो मैं टीम के किसी व्यक्ति से जवाब देने को कह सकता हूँ।',
  'hi-latn':
    'Agar aap chahein, to main team ke kisi vyakti se jawab dene ko keh sakta hoon.',
};

// COPY: needs approval
/** When nobody can be reached, "offer a person" becomes a plain pointer to the owner. */
const NO_PERSON: Record<ReplyLanguage, string> = {
  en: 'Please contact the organisation directly for this.',
  hi: 'इसके लिए कृपया संस्था से सीधे संपर्क करें।',
  'hi-latn': 'Iske liye kripya sanstha se seedhe sampark karein.',
};

export function noAnswerReply(
  mode: NoAnswerMode,
  language: ReplyLanguage,
  options: { helplineNumbers?: string | null; personAvailable?: boolean } = {},
): string {
  const person =
    options.personAvailable === false ? NO_PERSON[language] : PERSON[language];
  const parts =
    mode === 'say_unknown'
      ? [UNKNOWN[language]]
      : mode === 'offer_person'
        ? [person]
        : [UNKNOWN[language], person];
  return [...parts, helpLine(language, options.helplineNumbers)].join(' ');
}
