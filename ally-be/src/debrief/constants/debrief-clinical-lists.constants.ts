/**
 * The clinical word lists behind three card and reply checks (2026-11-16): the
 * clinical advisor and the owner edit them in Settings › Clinical lists, per
 * language. Entries are plain words or phrases, matched case-insensitively at
 * word boundaries; an editor never types a pattern. The English defaults are
 * exactly what the checks matched before the lists existed.
 *
 * What stays in code: the numeric score shapes ("70%", "7/10", "8 out of 10"),
 * which are not words, and the check codes themselves.
 */

export const CLINICAL_LIST_KINDS = ['jargon', 'diagnosis', 'score'] as const;
export type ClinicalListKind = (typeof CLINICAL_LIST_KINDS)[number];

/** The session languages the Debrief writes in. */
export const CLINICAL_LIST_LANGUAGES = [
  'en',
  'hi',
  'ta',
  'kn',
  'mr',
  'ml',
] as const;
export type ClinicalListLanguage = (typeof CLINICAL_LIST_LANGUAGES)[number];

export type ClinicalLists = Record<
  ClinicalListKind,
  Record<ClinicalListLanguage, string[]>
>;

/** Limits an edit is checked against. */
export const CLINICAL_ENTRY_MAX_CHARS = 80;
export const CLINICAL_LIST_MAX_ENTRIES = 200;

const cross = (a: string[], b: string[], join = ' ') =>
  a.flatMap((x) => b.map((y) => `${x}${join}${y}`));

/** v9 C-12: terms of art a lay counsellor was never taught. */
const JARGON_EN = [
  'countertransference',
  'counter-transference',
  'counter transference',
  'transference',
  'psychoeducation',
  'psycho-education',
  'psychoeducational',
  'psycho-educational',
  'cognitive distortion',
  'cognitive distortions',
  'defence mechanism',
  'defence mechanisms',
  'defense mechanism',
  'defense mechanisms',
  'somatisation',
  'somatization',
  'therapeutic alliance',
  'affective state',
  'affective response',
  'ego state',
  'ego states',
  'ego-state',
  'ego-states',
  'egostate',
  'egostates',
  'ego defence',
  'ego defences',
  'ego defense',
  'ego defenses',
  'ego-defence',
  'ego-defences',
  'ego-defense',
  'ego-defenses',
  'egodefence',
  'egodefences',
  'egodefense',
  'egodefenses',
  'dichotomous thinking',
  'catastrophising',
  'catastrophizing',
];

/** Labelling or diagnosing the trainee. */
const DIAGNOSIS_EN = [
  ...cross(cross(['you'], ['are', 'seem', 'sound', 'might be', 'may be']), [
    'anxious',
    'depressed',
    'insecure',
    'avoidant',
    'narcissistic',
    'codependent',
    'traumatised',
    'traumatized',
  ]),
  ...cross(cross(['you'], ['have', 'suffer from']), [
    'anxiety',
    'depression',
    'ptsd',
    'adhd',
    'a disorder',
  ]),
  ...cross(['personality', 'attachment'], ['disorder', 'style']),
];

/** A score in words (the numeric shapes stay in code). */
const SCORE_EN = [
  ...cross(['your', 'a'], ['score', 'rating', 'grade']),
  'scored',
];

const empty = (): Record<ClinicalListLanguage, string[]> =>
  Object.fromEntries(
    CLINICAL_LIST_LANGUAGES.map((l) => [l, []]),
  ) as unknown as Record<ClinicalListLanguage, string[]>;

export function defaultClinicalLists(): ClinicalLists {
  return {
    jargon: { ...empty(), en: [...JARGON_EN] },
    diagnosis: { ...empty(), en: [...DIAGNOSIS_EN] },
    score: { ...empty(), en: [...SCORE_EN] },
  };
}

/** The plain-words labels the Console shows. */
export const CLINICAL_LIST_LABELS: Record<ClinicalListKind, string> = {
  jargon: 'Terms a lay helper was not taught',
  diagnosis: 'Labels or diagnoses of the learner',
  score: 'Scores, ratings and grades',
};

/** One entry as typed: trimmed, inner spaces collapsed. */
export const normaliseEntry = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Why a list cannot be saved, or null. */
export function clinicalListProblem(
  kind: unknown,
  language: unknown,
  entries: unknown,
): string | null {
  if (!CLINICAL_LIST_KINDS.includes(kind as ClinicalListKind)) {
    return `${String(kind)} is not a clinical list`;
  }
  if (!CLINICAL_LIST_LANGUAGES.includes(language as ClinicalListLanguage)) {
    return `${String(language)} is not a language the lists cover`;
  }
  if (!Array.isArray(entries)) return 'entries must be a list of words';
  if (entries.length > CLINICAL_LIST_MAX_ENTRIES) {
    return `at most ${CLINICAL_LIST_MAX_ENTRIES} entries`;
  }
  for (const e of entries) {
    if (typeof e !== 'string' || !normaliseEntry(e)) {
      return 'every entry is a word or phrase';
    }
    if (normaliseEntry(e).length > CLINICAL_ENTRY_MAX_CHARS) {
      return `an entry is at most ${CLINICAL_ENTRY_MAX_CHARS} characters`;
    }
    if (/[\n\r]/.test(e)) return 'one word or phrase per entry';
  }
  return null;
}

/** The entries to keep: normalised, without repeats (case-insensitive). */
export function cleanEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const n = normaliseEntry(e);
    const k = n.toLowerCase();
    if (n && !seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}

/** Escapes the pattern syntax characters only: under the `u` flag `\-` is an error. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One pattern for a list: each entry escaped (an editor's text is never a
 * pattern), its spaces matching any run of spaces, bounded so it matches
 * whole words in any script. Null for an empty list.
 */
export function clinicalPattern(entries: readonly string[]): RegExp | null {
  const alts = cleanEntries([...entries])
    .sort((a, b) => b.length - a.length)
    .map((e) => escape(e).replace(/ /g, '\\s+'));
  if (!alts.length) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`,
    'iu',
  );
}

/** The compiled patterns the checks read for one session language. */
export interface ClinicalPatterns {
  jargon: RegExp | null;
  diagnosis: RegExp | null;
  score: RegExp | null;
}

/**
 * English plus the session's language: English words are mixed into every
 * language's debriefs, so the English lists always apply.
 */
export function clinicalPatternsFor(
  lists: ClinicalLists,
  language: string | null | undefined,
): ClinicalPatterns {
  const lang = String(language ?? 'en')
    .slice(0, 2)
    .toLowerCase() as ClinicalListLanguage;
  const pick = (kind: ClinicalListKind) =>
    clinicalPattern([
      ...(lists[kind]?.en ?? []),
      ...(lang !== 'en' ? (lists[kind]?.[lang] ?? []) : []),
    ]);
  return {
    jargon: pick('jargon'),
    diagnosis: pick('diagnosis'),
    score: pick('score'),
  };
}

/** Stored lists over the defaults; a list that no longer validates reads as its default. */
export function mergeClinicalLists(
  stored: Record<string, any> | null | undefined,
): ClinicalLists {
  const out = defaultClinicalLists();
  for (const kind of CLINICAL_LIST_KINDS) {
    for (const lang of CLINICAL_LIST_LANGUAGES) {
      const v = stored?.[kind]?.[lang];
      if (v !== undefined && clinicalListProblem(kind, lang, v) === null) {
        out[kind][lang] = cleanEntries(v);
      }
    }
  }
  return out;
}
