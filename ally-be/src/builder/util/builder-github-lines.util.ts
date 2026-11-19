import { BUILDER_GITHUB_FILE_MAX_BYTES } from '../constants/builder.constants';

/**
 * Line-addressed reading for the interview's GitHub tools: a range of a file, and where in a file
 * a search matched. Before this a read returned the first 50,000 bytes of a file and stopped, with
 * no way to read further, and a search returned paths with no idea where in them the match was.
 */

/** Search hits that get line numbers (each costs a file fetch). */
export const SEARCH_HITS_WITH_LINES = 3;
/** Matching lines reported per hit. */
const LINES_PER_HIT = 3;
/** A matching line is clipped to this many characters. */
const LINE_TEXT_MAX = 160;

const positive = (value: unknown): number | null => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : null;
};

/**
 * Lines `startLine`..`endLine` (1-based, inclusive) of `text`, then capped at the byte limit on a
 * whole line. Says where it stopped and how many lines the file has, so the next read can start
 * there. With no range it is the whole file, capped the same way.
 */
export function sliceFileLines(
  text: string,
  range: { startLine?: number; endLine?: number } = {},
): {
  content: string;
  truncated: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
  note?: string;
} {
  const all = text.split('\n');
  const totalLines = all.length;
  const start = Math.min(positive(range.startLine) ?? 1, totalLines);
  const requestedEnd = positive(range.endLine);
  const end = Math.max(start, Math.min(requestedEnd ?? totalLines, totalLines));

  const kept: string[] = [];
  let bytes = 0;
  let lastLine = start - 1;
  for (let index = start - 1; index < end; index++) {
    const line = all[index];
    const cost = Buffer.byteLength(line, 'utf8') + 1;
    if (kept.length && bytes + cost > BUILDER_GITHUB_FILE_MAX_BYTES) break;
    kept.push(
      // One line longer than the whole cap (minified code) is cut rather than skipped.
      cost > BUILDER_GITHUB_FILE_MAX_BYTES
        ? line.slice(0, BUILDER_GITHUB_FILE_MAX_BYTES)
        : line,
    );
    bytes += cost;
    lastLine = index + 1;
  }
  const truncated = lastLine < end;
  return {
    content: kept.join('\n'),
    truncated,
    startLine: start,
    endLine: lastLine,
    totalLines,
    ...(truncated
      ? {
          note:
            `Stopped at line ${lastLine} of ${totalLines} (the ${BUILDER_GITHUB_FILE_MAX_BYTES}-byte ` +
            `cap). Read on with startLine=${lastLine + 1}.`,
        }
      : {}),
  };
}

/**
 * What a search matched, as terms to find lines by: the text GitHub highlighted in its fragments,
 * or else the query's own words (qualifiers such as `extension:md` left out).
 */
export function searchTerms(query: string, items: any[]): string[] {
  const highlighted = new Set<string>();
  for (const item of items ?? []) {
    for (const match of item?.text_matches ?? []) {
      for (const hit of match?.matches ?? []) {
        const value = String(hit?.text ?? '').trim();
        if (value.length >= 2) highlighted.add(value.toLowerCase());
      }
    }
  }
  if (highlighted.size) return [...highlighted];
  return String(query ?? '')
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !word.includes(':') && word.length >= 2)
    .map((word) => word.toLowerCase());
}

/** The first few lines of `text` containing any term, 1-based. */
export function matchingLines(
  text: string,
  terms: string[],
  max = LINES_PER_HIT,
): { line: number; text: string }[] {
  if (!terms.length) return [];
  const out: { line: number; text: string }[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length && out.length < max; index++) {
    const lower = lines[index].toLowerCase();
    if (terms.some((term) => lower.includes(term))) {
      const flat = lines[index].trim();
      out.push({
        line: index + 1,
        text:
          flat.length > LINE_TEXT_MAX
            ? `${flat.slice(0, LINE_TEXT_MAX)}…`
            : flat,
      });
    }
  }
  return out;
}
