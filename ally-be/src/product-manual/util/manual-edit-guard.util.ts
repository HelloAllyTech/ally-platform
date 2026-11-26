/**
 * Protection against an agent replacing a page with a fragment.
 *
 * `edit_manual_page` takes the WHOLE new body. In production the weekly agent applied a proposal by
 * sending the proposal's own text as `newBody`, and a 5,222-character page became 830 characters of
 * proposal. Nothing in the tool noticed, because the text passed the scrubber and cited a source.
 *
 * An edit is refused when it would drop most of a page that is more than a few lines long: fewer than
 * 60% of the page's non-empty lines survive, or the page loses more than half its length. A small
 * page is free to change completely; a real change to a long page (a row, a paragraph, a section)
 * keeps nearly every other line, so it passes.
 */

/** Pages shorter than both of these are free to rewrite. */
const SMALL_PAGE_LINES = 8;
const SMALL_PAGE_CHARS = 600;
/** At least this share of the existing non-empty lines must survive an edit. */
const MIN_KEPT_LINES = 0.6;
/** The new body must be at least this share of the old length. */
const MIN_LENGTH = 0.5;

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** A plain-words refusal for the model when the edit would remove most of the page, else null. */
export function pageLossRefusal(
  oldBody: string,
  newBody: string,
): string | null {
  const oldLines = linesOf(oldBody ?? '');
  const oldLength = (oldBody ?? '').trim().length;
  if (oldLines.length < SMALL_PAGE_LINES && oldLength < SMALL_PAGE_CHARS) {
    return null;
  }
  const newLines = new Set(linesOf(newBody ?? ''));
  const kept = oldLines.filter((line) => newLines.has(line)).length;
  const keptShare = oldLines.length ? kept / oldLines.length : 1;
  const lengthShare = oldLength ? (newBody ?? '').trim().length / oldLength : 1;
  if (keptShare >= MIN_KEPT_LINES && lengthShare >= MIN_LENGTH) return null;
  return (
    `That edit would remove most of the page: it keeps only ${Math.round(keptShare * 100)}% of the ` +
    `existing lines and ${Math.round(lengthShare * 100)}% of its length. edit_manual_page replaces ` +
    'the WHOLE page, so newBody must be the entire page with your change made in place and every ' +
    'unchanged line kept exactly as it is. Never send only the changed part, a summary of it, or ' +
    "a proposal's text. Read the page again, copy it in full, and change only what is wrong. If the " +
    'page needs a rewrite, do not do it here: leave it and say in one sentence what needs rewriting.'
  );
}
