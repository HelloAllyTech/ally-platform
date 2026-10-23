import { BuilderPrdReadiness } from '../type/builder-prd.type';

/**
 * What Builder's reply claims about the PRD, read from its words.
 *
 * Two claims matter because the admin acts on them: "I've updated the PRD"
 * (they stop checking the document) and "the PRD is ready" (they press Start).
 * Session 2bc3a5cf's last reply said "revised" over an edit that had failed.
 * The validated turn checks both against the document before the reply is
 * shown, and the replay eval counts the ones that got through — the same
 * patterns for both, so the eval measures what the runner enforces.
 *
 * Deliberately narrow. "I'll update" is a promise, not a claim, and is left
 * alone; a check that fires on ordinary sentences teaches the model to write
 * around it rather than to make the edit.
 */

/** Prose that tells the admin the PRD moved. */
export const CLAIMS_A_PRD_EDIT =
  /\b(I'?ve|I have|I)\s+(just\s+)?(updated|revised|added|amended|rewritten|recorded|captured|incorporated|reflected|written)\b|\b(updated|revised)\s+the\s+PRD\b|\bPRD\s+(is|has been|now)\s+(updated|revised)\b/i;

export function claimsPrdEdit(text: string | null | undefined): boolean {
  return CLAIMS_A_PRD_EDIT.test(String(text ?? ''));
}

/**
 * Prose that tells the admin the PRD can be built from now — said outright,
 * as an invitation to start the build, or as the next stage beginning. The
 * last two are how most of suite 5d24dd95's premature endings were worded
 * ("You can start the build whenever you're ready", "The build is now ready
 * to start", "Next, a technical design will be drafted from this PRD"); the
 * simulated admin, like a real one, stops there.
 */
const CLAIMS_READY = new RegExp(
  [
    String.raw`build[- ]ready`,
    String.raw`ready (?:to|for) (?:be )?(?:build|built|building|the build|a build|technical design|the technical design|design|development|implementation)`,
    String.raw`(?:PRD|plan|it|document|spec) is (?:now )?(?:\w+ and )?(?:ready|complete|final|finali[sz]ed)`,
    String.raw`readiness is (?:now )?(?:at )?100`,
    String.raw`build is (?:now )?ready`,
    String.raw`build (?:can|will) (?:now )?(?:start|begin|go ahead|proceed)`,
    String.raw`(?:start|kick off|begin|run) (?:the|your) build`,
    String.raw`(?:press|click|hit)(?:ing)? (?:the )?["“'‘]?start`,
    String.raw`technical design (?:can|will) (?:now )?be (?:drafted|written|started|created)`,
    String.raw`next step is (?:for |to (?:draft|write|start) )?(?:a |the )?technical design`,
    String.raw`(?:move|moving|go|proceed) (?:on )?to (?:a |the )?technical design`,
  ]
    .map((pattern) => String.raw`\b${pattern}\b`)
    .join('|'),
  'gi',
);

/**
 * Words just before a match that make it something other than a claim:
 * a negation ("not ready to build"), a condition ("once it is build-ready"),
 * or work towards it ("to get this ready to build").
 */
const NOT_A_CLAIM =
  /(?:\b(?:not|never|almost|nearly|once|until|when|before|after|if|close to|get|getting|make|making|towards?)|n['’]t)\s+(?:yet\s+)?(?:\w+\s+){0,2}$/i;

/**
 * A sentence that opens on a condition ("Once R3 has an owner, you can start
 * the build"), on a purpose ("To start the build, …"), or is a question
 * ("Shall I mark it build-ready?") states nothing about the PRD as it is.
 * "When you're ready" is the exception — it is how "it's ready" is usually
 * said — and "after" is left out: "After the fixes, the PRD is ready" is a
 * claim.
 */
const CONDITIONAL_OPENING =
  /^\W*(?:once|if|unless|until|as soon as|to|when(?!\s+you(?:['’]re|\s+are)\s+(?:ready|happy|satisfied|set)))\b/i;
const QUESTION_OPENING =
  /^\W*(?:is|are|shall|should|do|does|can|could|would|will|may)\b/i;

/** Where the sentence holding `index` starts and ends. */
function sentenceAround(
  value: string,
  index: number,
): { opening: string; closing: string } {
  let start = 0;
  for (const end of value.slice(0, index).matchAll(/[.!?]["')\]]*\s+|\n/g)) {
    start = (end.index ?? 0) + end[0].length;
  }
  const rest = value.slice(index);
  const close = rest.search(/[.!?](?:\s|$)|\n/);
  return {
    opening: value.slice(start, index),
    closing: close === -1 ? '' : rest[close],
  };
}

export function claimsPrdReady(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  for (const match of value.matchAll(CLAIMS_READY)) {
    const index = match.index ?? 0;
    const before = value.slice(Math.max(0, index - 30), index);
    if (NOT_A_CLAIM.test(before)) continue;
    const { opening, closing } = sentenceAround(value, index);
    if (CONDITIONAL_OPENING.test(opening)) continue;
    if (closing === '?' && QUESTION_OPENING.test(opening)) continue;
    return true;
  }
  return false;
}

/**
 * What the admin is told under a reply that still claims the PRD is ready
 * after the turn ran out of chances to fix it: what readiness still lists,
 * in the words of its admin-facing hints. Without it the admin reads "start
 * the build" over a Start button that will not press, or stops answering.
 */
export function notReadyNote(
  readiness: Pick<BuilderPrdReadiness, 'sections'>,
): string {
  const hints = readiness.sections
    .filter((section) => !section.ok)
    .map((section) => section.hint.trim().replace(/\.$/, ''))
    .filter(Boolean);
  const listed =
    hints.length > 3
      ? `${hints.slice(0, 3).join('; ')}; and ${hints.length - 3} more`
      : hints.join('; ');
  return `Not ready to build yet${listed ? ` — ${listed}` : ''}.`;
}
