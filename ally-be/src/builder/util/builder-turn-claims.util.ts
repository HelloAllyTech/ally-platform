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
    String.raw`ready (?:to|for) (?:be )?(?:build|built|building|the build|a build|technical design|the technical design|design|development|implementation|the next (?:step|stage|phase))`,
    String.raw`(?:PRD|plan|it|document|spec) is (?:now )?(?:\w+ and )?(?:ready|complete|final|finali[sz]ed)`,
    String.raw`readiness is (?:now )?(?:at )?100`,
    String.raw`build is (?:now )?ready`,
    String.raw`build (?:can|will) (?:now )?(?:start|begin|go ahead|proceed)`,
    String.raw`(?:start|kick off|begin|run) (?:the|your) build`,
    String.raw`(?:press|click|hit)(?:ing)? (?:the )?["“'‘]?start`,
    String.raw`technical design (?:can|will) (?:now )?be (?:drafted|written|started|created)`,
    String.raw`next step is (?:for |to (?:draft|write|start) )?(?:a |the )?technical design`,
    String.raw`(?:move|moving|go|proceed) (?:on )?to (?:a |the )?technical design`,
    String.raw`good to go`,
    String.raw`in place (?:to (?:start )?build(?:ing)?|for the build)`,
    String.raw`ready to (?:start|begin) (?:the )?build(?:ing)?`,
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
 * "After" is left out: "After the fixes, the PRD is ready" is a claim.
 */
const CONDITIONAL_OPENING =
  /^\W*(?:once|if|unless|until|as soon as|to|when(?:ever)?)\b/i;
/** The same conditions trailing the claim: "…start the build once R3 has an owner." */
const TRAILING_CONDITION =
  /\b(?:once|if|unless|until|as soon as|when(?:ever)?)\b/i;
const QUESTION_OPENING =
  /^\W*(?:is|are|shall|should|do|does|can|could|would|will|may)\b/i;

/**
 * A condition that is only the admin's sign-off — "if you're happy with it",
 * "once you've reviewed it", "when you are", "if everything looks good" — is
 * the claim, not an exception to it: nothing is left but their say-so. It is
 * also the cheapest rewording after a send-back, so it must not get through.
 * Confirming something ("once you confirm A2") is a real blocker and is not
 * in this list.
 */
const ADMIN_SIGN_OFF = new RegExp(
  [
    String.raw`you(?:['’]re|\s+are)\s+(?:\w+\s+){0,2}(?:happy|satisfied|ok|okay|ready|set|good|fine|comfortable)\b`,
    String.raw`you(?:['’]re|\s+are)(?=\s*(?:[.!?,;]|$))`,
    String.raw`you(?:['’]ve|\s+have)?\s+(?:\w+\s+)?(?:review|reviewed|read|checked|looked|approve|approved|agree|agreed)\b`,
    String.raw`you(?:['’]d|\s+would)?\s+(?:like|want|wish)\b`,
    String.raw`(?:this|it|everything|that|all|all of (?:this|it)|the (?:PRD|plan))\s+(?:\w+\s+)?looks?\s+(?:right|good|fine|ok|okay|correct)\b`,
  ]
    .map((pattern) => `^\\s*(?:${pattern})`)
    .join('|'),
  'i',
);

/** An invitation to start the build stays a claim even as a question. */
const INVITES_START = /^(?:start|kick off|begin|run) (?:the|your) build$/i;

/** Where the sentence holding `index` starts and ends. */
function sentenceAround(
  value: string,
  index: number,
): { opening: string; rest: string; closing: string } {
  let start = 0;
  for (const end of value.slice(0, index).matchAll(/[.!?]["')\]]*\s+|\n/g)) {
    start = (end.index ?? 0) + end[0].length;
  }
  const rest = value.slice(index);
  const close = rest.search(/[.!?](?:\s|$)|\n/);
  return {
    opening: value.slice(start, index),
    rest: close === -1 ? rest : rest.slice(0, close),
    closing: close === -1 ? '' : rest[close],
  };
}

/** The sentence is conditional on something other than the admin's sign-off. */
function realCondition(after: string): boolean {
  return !ADMIN_SIGN_OFF.test(after);
}

export function claimsPrdReady(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  for (const match of value.matchAll(CLAIMS_READY)) {
    const index = match.index ?? 0;
    const before = value.slice(Math.max(0, index - 30), index);
    if (NOT_A_CLAIM.test(before)) continue;
    const { opening, rest, closing } = sentenceAround(value, index);
    const leading = CONDITIONAL_OPENING.exec(opening);
    if (leading && realCondition(opening.slice(leading[0].length))) continue;
    const tail = rest.slice(match[0].length);
    const trailing = TRAILING_CONDITION.exec(tail);
    if (
      trailing &&
      realCondition(tail.slice((trailing.index ?? 0) + trailing[0].length))
    ) {
      continue;
    }
    if (
      closing === '?' &&
      QUESTION_OPENING.test(opening) &&
      !INVITES_START.test(match[0])
    ) {
      continue;
    }
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
