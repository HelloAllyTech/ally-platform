/**
 * The debrief's language when the session recorded none (v9 FR-39): read
 * from what the learner wrote. Script decides Tamil, Kannada and English;
 * Devanagari is Hindi or Marathi, told apart by their most common words,
 * and a close call is low confidence — the run is flagged, never silent.
 */
export type LanguageSource =
  | 'recorded'
  | 'detected'
  | 'detected_low_confidence';

const SCRIPTS: Array<{ lang: string; re: RegExp }> = [
  { lang: 'ta', re: /[஀-௿]/g },
  { lang: 'kn', re: /[ಀ-೿]/g },
  { lang: 'deva', re: /[ऀ-ॿ]/g },
  { lang: 'en', re: /[A-Za-z]/g },
];

/** Words common in one of the two and rare in the other. */
const MARATHI =
  /(^|\s)(आहे|आहेत|नाही|आणि|तुम्ही|मला|मी|काय|होते|पण|तर|करू)(?=\s|$|[.,?!])/g;
const HINDI =
  /(^|\s)(है|हैं|नहीं|और|आप|मुझे|मैं|क्या|था|लेकिन|तो|करो)(?=\s|$|[.,?!])/g;

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

export function detectLanguage(texts: string[]): {
  language: string;
  source: Exclude<LanguageSource, 'recorded'>;
} {
  const text = texts.join(' ');
  // Letters and their combining marks: Indic vowel signs are marks, not letters.
  const letters = count(text, /[\p{L}\p{M}]/gu);
  if (letters === 0) {
    return { language: 'en', source: 'detected_low_confidence' };
  }
  // Too little to be sure of, but the script still says more than a default.
  const thin = letters < 20;
  const ranked = SCRIPTS.map((s) => ({
    lang: s.lang,
    n: count(text, s.re),
  })).sort((a, b) => b.n - a.n);
  const top = ranked[0];
  const share = top.n / letters;
  if (top.lang !== 'deva') {
    return {
      language: top.lang,
      source: share >= 0.6 && !thin ? 'detected' : 'detected_low_confidence',
    };
  }
  const mr = count(text, MARATHI);
  const hi = count(text, HINDI);
  const language = mr > hi ? 'mr' : 'hi';
  const clear = Math.abs(mr - hi) >= 2 && share >= 0.6 && !thin;
  return { language, source: clear ? 'detected' : 'detected_low_confidence' };
}
