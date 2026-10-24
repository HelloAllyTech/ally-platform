/**
 * Small text helpers for the deterministic checks. No dependencies, no
 * locale tables: the guide speaks English, Hindi (Devanagari and romanised),
 * Marathi, Tamil and Kannada, and these work on all of them by script.
 */

/** Lower case, NFKC, punctuation to spaces, single-spaced. */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function wordCount(text: string): number {
  return words(text).length;
}

/** Sentences, split after . ! ? and the Devanagari danda. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।॥])\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

/** Whether `needle` occurs in `haystack` as whole words (both normalised). */
export function containsPhrase(haystack: string, needle: string): boolean {
  const h = ` ${normalise(haystack)} `;
  const n = normalise(needle);
  return n.length > 0 && h.includes(` ${n} `);
}

/** Word n-grams of a normalised text. */
export function ngrams(text: string, n: number): Set<string> {
  const tokens = normalise(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

/** True when the two texts share any run of `n` words. */
export function sharesNgram(a: string, b: string, n: number): boolean {
  const left = ngrams(a, n);
  if (!left.size) return false;
  for (const gram of ngrams(b, n)) if (left.has(gram)) return true;
  return false;
}

export type Script = 'latin' | 'devanagari' | 'tamil' | 'kannada' | 'other';

const SCRIPT_RANGES: Array<[Script, RegExp]> = [
  ['devanagari', /[ऀ-ॿ]/u],
  ['tamil', /[஀-௿]/u],
  ['kannada', /[ಀ-೿]/u],
  ['latin', /[A-Za-z]/],
];

/** Letter counts per script. */
export function scriptCounts(text: string): Record<Script, number> {
  const counts: Record<Script, number> = {
    latin: 0,
    devanagari: 0,
    tamil: 0,
    kannada: 0,
    other: 0,
  };
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    const match = SCRIPT_RANGES.find(([, pattern]) => pattern.test(char));
    counts[match ? match[0] : 'other']++;
  }
  return counts;
}

/** The script holding at least 60% of the letters, else null (mixed or none). */
export function dominantScript(text: string): Script | null {
  const counts = scriptCounts(text);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (!total) return null;
  const [script, count] = (
    Object.entries(counts) as Array<[Script, number]>
  ).sort((a, b) => b[1] - a[1])[0];
  return count / total >= 0.6 ? script : null;
}

/**
 * Common function words of romanised Hindi. Two or more in a message, as a
 * quarter of its words, reads as Hinglish rather than English.
 */
const HINGLISH = new Set([
  'hai',
  'hain',
  'kya',
  'nahi',
  'nahin',
  'mujhe',
  'mera',
  'meri',
  'mere',
  'mein',
  'aap',
  'tum',
  'kaise',
  'kyun',
  'kyon',
  'bahut',
  'accha',
  'acha',
  'theek',
  'thik',
  'kar',
  'karna',
  'karo',
  'raha',
  'rahi',
  'tha',
  'thi',
  'ho',
  'hoon',
  'hu',
  'bhi',
  'lekin',
  'aur',
  'yeh',
  'ye',
  'woh',
  'kuch',
  'samajh',
  'batao',
  'chahiye',
  'kaam',
  'sakta',
  'sakti',
  'gaya',
  'gayi',
  'haan',
]);

export function hinglishShare(text: string): { hits: number; share: number } {
  const tokens = normalise(text).split(' ').filter(Boolean);
  if (!tokens.length) return { hits: 0, share: 0 };
  const hits = tokens.filter((token) => HINGLISH.has(token)).length;
  return { hits, share: hits / tokens.length };
}

export function looksHinglish(text: string): boolean {
  const { hits, share } = hinglishShare(text);
  return hits >= 2 && share >= 0.25;
}
