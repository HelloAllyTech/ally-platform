/**
 * "Correct this" (chunk 20d): find where a learned fact came from in its page's text, so the
 * owner's correction can replace it there and the original stops being searchable.
 *
 * Facts are the builder's summaries, not quotes, so the match is by shared words: the sentence of
 * the page holding most of the fact's content words. Below the threshold nothing is replaced; the
 * correction then goes into the owner's notes only and the owner is told.
 */

const MIN_SHARE = 0.6;
const STOP = new Set(
  'the and for are with you your our from that this have has was were will can not but all any its their them they his her she him who what when where which how into onto over also than then there here about just only some such very per each'.split(
    ' ',
  ),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}₹$€£.,:]+/gu) ?? [])
    .map((w) => w.replace(/^[.,:]+|[.,:]+$/g, ''))
    .filter((w) => w.length >= 3 || /\d/.test(w))
    .filter((w) => !STOP.has(w));
}

/** Sentences with their positions, split on full stops, question and exclamation marks, and lines. */
function sentences(
  text: string,
): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const pattern = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$|(?=\n))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (!match[0].trim()) {
      pattern.lastIndex += 1;
      continue;
    }
    const lead = match[0].length - match[0].trimStart().length;
    const body = match[0].trim();
    out.push({
      start: match.index + lead,
      end: match.index + lead + body.length,
      text: body,
    });
  }
  return out;
}

/** The sentence a fact most likely came from, or null when none shares enough of its words. */
export function findSource(
  pageText: string,
  fact: string,
): { start: number; end: number; text: string; share: number } | null {
  const wanted = new Set(words(fact));
  if (!wanted.size) return null;
  let best: { start: number; end: number; text: string; share: number } | null =
    null;
  for (const sentence of sentences(pageText)) {
    const have = new Set(words(sentence.text));
    let shared = 0;
    for (const w of wanted) if (have.has(w)) shared += 1;
    const share = shared / wanted.size;
    if (share >= MIN_SHARE && (!best || share > best.share)) {
      best = { ...sentence, share };
    }
  }
  return best;
}

/** The page's text with the fact's sentence replaced by the correction, or null when not found. */
export function replaceSource(
  pageText: string,
  fact: string,
  correction: string,
): string | null {
  const found = findSource(pageText, fact);
  if (!found) return null;
  const replacement = /[.!?]$/.test(correction) ? correction : `${correction}.`;
  return `${pageText.slice(0, found.start)}${replacement}${pageText.slice(found.end)}`;
}
