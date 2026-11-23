/**
 * Cheap, deterministic text similarity for dedupe, memory retrieval and exemplar lookup.
 *
 * No embeddings on purpose: dedupe runs on every candidate of every run and must give the same
 * answer twice (a test can pin it), and the repo's embedding path lives in ally-ai behind a
 * network call. Normalised-token overlap catches reworded titles ("Show streak on start screen"
 * vs "Show the streak count on the roleplay start screen"); character trigrams catch spelling
 * and inflection differences the token pass misses.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'by',
  'at',
  'from',
  'into',
  'is',
  'are',
  'be',
  'it',
  'its',
  'this',
  'that',
  'as',
  'so',
  'not',
  'no',
  'we',
  'our',
  'you',
  'your',
  'their',
  'when',
  'which',
  'what',
  'add',
  'make',
  'use',
  'ally',
  'page',
  'screen',
]);

/** Light stemming: enough that "learners" ≈ "learner", "showing" ≈ "show". */
const stem = (word: string): string =>
  word
    .replace(/(?:ing|ed|es|s)$/u, '')
    .replace(/(.)\1$/u, '$1')
    .slice(0, 24);

export function tokens(text: string): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem)
    .filter((word) => word.length > 1);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokens(text));
}

function trigrams(text: string): Set<string> {
  const clean = ` ${tokens(text).join(' ')} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= clean.length; i += 1) out.add(clean.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** |A∩B| / min(|A|,|B|): a short title contained in a long description scores high. */
function containment(a: Set<string>, b: Set<string>): number {
  const small = Math.min(a.size, b.size);
  if (small < 4) return 0; // too few words to call one text "contained" in another
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / small;
}

/** 0..1. ≥ 0.6 reads as "the same idea" for dedupe (PM_DEDUPE.DUPLICATE_THRESHOLD). */
export function similarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  return Math.max(
    jaccard(ta, tb),
    0.85 * containment(ta, tb),
    0.9 * jaccard(trigrams(a), trigrams(b)),
  );
}

/** Relevance of `text` to a query: shared-token count weighted by query coverage. */
export function relevance(query: string, text: string): number {
  const q = tokenSet(query);
  if (!q.size) return 0;
  const t = tokenSet(text);
  let hit = 0;
  for (const word of q) if (t.has(word)) hit += 1;
  return hit / q.size;
}
