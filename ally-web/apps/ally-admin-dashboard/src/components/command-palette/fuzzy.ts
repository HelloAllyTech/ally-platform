/**
 * Fuzzy matching for the command palette: a query matches when its characters appear in the
 * text in order (so "rlp" finds "Roleplays", "ai t" finds "AI Tasks"). Higher scores are better:
 * a prefix beats a word-start, which beats a run of consecutive letters, which beats scattered ones.
 */

const isWordStart = (text: string, index: number): boolean =>
  index === 0 || /[\s\-_/&]/.test(text[index - 1]);

/** Score `query` against `text`, or `null` when it does not match. Both are compared case-insensitively. */
export const fuzzyScore = (query: string, text: string): number | null => {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let previous = -2;
  for (let qi = 0; qi < q.length; qi += 1) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    score += 1;
    if (found === previous + 1) score += 4; // consecutive
    if (isWordStart(t, found)) score += 3; // start of a word
    if (found === 0 && qi === 0) score += 4; // starts the text
    // Gaps cost a little, so a tight match outranks a spread-out one.
    if (previous >= 0) score -= Math.min(found - previous - 1, 3) * 0.5;
    previous = found;
    ti = found + 1;
  }
  // A shorter text that fully contains the query ranks above a longer one.
  score -= t.length * 0.05;
  if (t.includes(q)) score += 6;
  return score;
};

export interface Searchable {
  id: string;
  label: string;
  /** Extra words that should find this item (its section, for instance). Matched at lower weight. */
  keywords?: string[];
}

/** Items matching `query`, best first. An empty query returns everything in its given order. */
export const fuzzyFilter = <T extends Searchable>(items: T[], query: string): T[] => {
  if (!query.trim()) return items;
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const own = fuzzyScore(query, item.label);
    const viaKeyword = (item.keywords ?? [])
      .map(keyword => fuzzyScore(query, keyword))
      .filter((s): s is number => s !== null);
    const best = Math.max(
      own ?? Number.NEGATIVE_INFINITY,
      viaKeyword.length ? Math.max(...viaKeyword) - 5 : Number.NEGATIVE_INFINITY,
    );
    if (best !== Number.NEGATIVE_INFINITY) scored.push({ item, score: best, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(s => s.item);
};
