/**
 * The language a fixed reply goes out in (Q3-fast): the run-failed reply now, the crisis and
 * emergency replies from Part 1. Fixed, approved texts exist in English and Hindi only, so this
 * picks one of them, never a generated translation.
 *
 * - `hi`: the message is in Devanagari, or nothing else says otherwise and the person's stored
 *   locale is Hindi.
 * - `hi-latn`: Hinglish, Hindi written in Latin script ("mujhe kabhi kabhi lagta hai…"), which is
 *   how most Hindi arrives on WhatsApp and the bot page. It gets the Hindi text in Latin script.
 * - `en`: everything else.
 */
export type ReplyLanguage = 'en' | 'hi' | 'hi-latn';

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Common Hindi words as they are typed in Latin script. Two or more mark a message as Hinglish;
 * one alone is too weak ("hai" in a name, "ho" in English).
 */
const HINGLISH_WORDS = new Set([
  'hai',
  'hain',
  'nahi',
  'nahin',
  'nhi',
  'mujhe',
  'mujhko',
  'mera',
  'meri',
  'mere',
  'kya',
  'kyun',
  'kyu',
  'kaise',
  'karna',
  'karo',
  'karein',
  'raha',
  'rahi',
  'rahe',
  'hoon',
  'aap',
  'aapka',
  'aapke',
  'tum',
  'bahut',
  'bhi',
  'sab',
  'kuch',
  'abhi',
  'wala',
  'wali',
  'chahiye',
  'lagta',
  'accha',
  'acha',
  'yaar',
  'matlab',
  'kab',
  'kahan',
  'kaha',
  'hum',
  'humein',
  'gaya',
  'gayi',
  'diya',
  'kal',
  'aaj',
  'liye',
  'koi',
  'ke',
  'ki',
  'ka',
  'se',
  'ko',
]);

export function replyLanguageOf(
  text: string,
  locale?: string | null,
): ReplyLanguage {
  if (DEVANAGARI.test(text)) return 'hi';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hindiWords = words.filter((word) => HINGLISH_WORDS.has(word)).length;
  if (hindiWords >= 2) return 'hi-latn';
  if (locale?.trim().toLowerCase().startsWith('hi')) return 'hi';
  return 'en';
}
