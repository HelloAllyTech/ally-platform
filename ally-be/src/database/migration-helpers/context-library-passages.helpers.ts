/**
 * String helpers for `1981000800000-CopyGuideAndDebriefPassagesIntoContextLibrary`.
 *
 * Kept out of the migration file on purpose: TypeORM instantiates every function a migration file
 * exports, and an arrow function is not a constructor, so exporting these from the migration made
 * `migration:run` throw "someClass is not a constructor" before running anything. It sits outside
 * `migrations/` because `migration-timestamps.spec.ts` requires every file there to be a migration.
 */
export const PASSAGE_SYNC_PREFIX = 'kb_document_chunks:';

const STATEMENT_MAX = 200;
export const DEBRIEF_KINDS = [
  'practice_guideline',
  'style_guide',
  'level_guide',
  'protocol',
];
export const DEBRIEF_LEVELS = [
  'lay',
  'early_professional',
  'experienced_professional',
];

/** Lower-kebab, as the Context Library normalises free-text facets. */
export const tagOf = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** "Title by First Last" → "Title". Two to four capitalised words, so "Stand by Me" stays. */
export const withoutByline = (title: string): string =>
  String(title ?? '')
    .replace(/\s+by\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,3}\s*$/, '')
    .trim();

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
};

/** The heading an imported passage carries until enrichment writes a one-line statement. */
export const headingFor = (
  title: string,
  sectionPath: string | null,
  body: string,
): string => {
  const leaf = (sectionPath ?? '')
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  const heading = [title, leaf].filter(Boolean).join(' — ');
  return clip(heading || body, STATEMENT_MAX) || 'Imported passage';
};
