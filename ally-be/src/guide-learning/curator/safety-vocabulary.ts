import { normalise } from '../checks/text.util';

/**
 * Words that put a curator change in front of a person instead of a release
 * (plans/ally-guide/plan.md §7.13: "anything touching safety vocabulary is
 * quarantined for a human"). Deliberately broad: a false hit costs one
 * person's read, a miss lets the loop rewrite how Ally talks about risk on
 * its own. Matched on whole normalised words or phrases, in every language
 * the guide speaks, romanised Hindi included.
 */
export const SAFETY_VOCABULARY: readonly string[] = [
  // English
  'suicide',
  'suicidal',
  'self harm',
  'self-harm',
  'selfharm',
  'kill',
  'killing',
  'die',
  'dying',
  'death',
  'dead',
  'overdose',
  'harm',
  'hurt myself',
  'abuse',
  'abused',
  'violence',
  'assault',
  'rape',
  'emergency',
  'crisis',
  'helpline',
  'hotline',
  'danger',
  'unsafe',
  'safety',
  'safe',
  'risk',
  'sentinel',
  'care mode',
  'distress',
  'wellbeing',
  'diagnose',
  'diagnosis',
  'medication',
  'prescription',
  'refer',
  'referral',
  'supervisor',
  'police',
  'hospital',
  // Hindi (Devanagari) and romanised
  'आत्महत्या',
  'खुदकुशी',
  'मरना',
  'मर',
  'जान',
  'नुकसान',
  'खतरा',
  'aatmahatya',
  'atmahatya',
  'khudkushi',
  'marna',
  'mar jaana',
  'jaan dena',
  // Marathi, Tamil, Kannada
  'आत्महत्येचा',
  'தற்கொலை',
  'ಆತ್ಮಹತ್ಯೆ',
];

const PHRASES = SAFETY_VOCABULARY.map((term) => normalise(term)).filter(
  Boolean,
);

/** The safety words a text contains (normalised, whole words), if any. */
export function safetyTermsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const haystack = ` ${normalise(text)} `;
  return [...new Set(PHRASES.filter((term) => haystack.includes(` ${term} `)))];
}
