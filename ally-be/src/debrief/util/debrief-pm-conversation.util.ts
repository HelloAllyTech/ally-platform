import type { DebriefAction } from './debrief-console-roles.util';
import { alwaysAsk } from './debrief-always-ask.util';
import { normaliseForQuote, unmatchedQuotes } from './debrief-cards.util';
import type {
  DebriefPmMessage,
  PmAbout,
  PmAction,
} from '../entity/debrief-pm-message.entity';

/**
 * The PM agent conversation's rules that need no database (V2_AUTONOMY C1–C3):
 * what counts as a yes, who may carry out an action, and the contract's
 * `PmMessage`. Which changes always ask is the core's `debrief-always-ask.util.ts`.
 */

/**
 * An explicit yes: the whole message agrees and asks for nothing else.
 * "yes", "Yes, go ahead.", "ok do it", "haan", "हाँ" — not "yes but only for
 * Hindi", not "why?", not "no".
 */
const YES =
  /^(yes|yep|yeah|yup|y|ok|okay|sure|confirm(ed)?|approved?|go ahead|do it|please do|proceed|haan|han|ha|ji|ji haan|हाँ|हां|ஆம்|होय)([\s,.!]+(yes|please|go ahead|do it|confirm(ed)?|thanks?|thank you|proceed|that'?s right))*[\s.!]*$/i;

export function isExplicitYes(text: string): boolean {
  return YES.test((text ?? '').trim());
}

/** Never a learner's words: anything here is staff text, but keep messages bounded. */
export const MAX_MESSAGE_CHARS = 4000;

/** A pinned-rule item from before pinned rules moved to the Skills Store; history only. */
export function isPinnedRuleChange(idea: {
  change?: Record<string, any> | null;
}): boolean {
  return idea.change?.ideaKind === 'pinned_rule';
}

/**
 * Who may carry out an action on this change (debrief-console-roles.util.ts): a budget
 * increase the owner's, everything else the PM agent permission's.
 */
export function requiredAction(idea: {
  change?: Record<string, any> | null;
  evidence?: Record<string, any> | null;
}): DebriefAction {
  // The core's always-ask list (debrief-always-ask.util.ts), its locked kinds only.
  const kind = alwaysAsk(idea, {
    askLowConfidence: false,
    askModels: false,
  })?.kind;
  if (
    kind === 'budget_increase' ||
    idea.change?.budgetOnly ||
    idea.change?.budgetIncrease
  ) {
    return 'ownerSettings';
  }
  return 'pmAgent';
}

/** Who to name when someone lacks the permission. */
export function whoDecides(action: DebriefAction): string {
  return action === 'ownerSettings'
    ? 'the owner'
    : 'the Ally team or the owner';
}

/** The contract's `PmMessage` (V2_AUTONOMY API contract). */
export interface PmMessageView {
  id: string;
  at: string;
  who: 'person' | 'agent';
  author: string | null;
  text: string;
  about: PmAbout | null;
  action: PmAction | null;
}

export function toPmMessage(m: DebriefPmMessage): PmMessageView {
  return {
    id: m.id,
    at: new Date(m.createdAt).toISOString(),
    who: m.who,
    author: m.who === 'person' ? (m.authorName ?? null) : null,
    text: m.text,
    about: m.about
      ? {
          kind: m.about.kind,
          ...(m.about.id ? { id: m.about.id } : {}),
          label: m.about.label,
        }
      : null,
    action: m.action
      ? { label: m.action.label, status: m.action.status }
      : null,
  };
}

/** A label for a change in a sentence: “Shorter Tamil cards”. */
export function changeName(idea: { text?: string | null }): string {
  const t = (idea.text ?? '').trim();
  return t ? `“${t.slice(0, 120)}”` : 'this change';
}

/**
 * Every string in a tool answer or an evidence object: the texts a reply may
 * quote from (`pmReplyUnmatched`).
 */
export function textLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) textLeaves(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) textLeaves(v, out);
  }
  return out;
}

/** What introduces a change's wording or a rule's text, verbatim, after a colon. */
const LEAD =
  '(?:new wording|old wording|wording|rule text|rule|new text|old text|before|after|replacement|it reads|reads|it says|says)';
const PRESENTED = new RegExp(
  `\\b${LEAD}\\s*:\\s*([^\\n]+?)(?=\\s+${LEAD}\\s*:|\\n|$)`,
  'gi',
);
/** A block-quoted line ("> …"). */
const BLOCK_QUOTE = /^\s*>\s*(.+)$/gm;
/** Fragments shorter than this are not checked (as in Ask Ally's quote check). */
const SHORTEST_CHECKED = 12;

/**
 * What a PM agent reply quotes, or presents as a change's wording or a rule's
 * text, that none of the turn's sources holds verbatim (whitespace and quote
 * marks normalised): Ask Ally's check (`unmatchedQuotes`) for quoted text,
 * plus text after "wording:", "rule:", "before:", "after:", "reads:" and
 * block quotes. Shorter fragments are not checked.
 */
export function pmReplyUnmatched(reply: string, sources: string[]): string[] {
  const said = sources.map(normaliseForQuote);
  const out = unmatchedQuotes(reply, sources);
  const presented = [
    ...[...reply.matchAll(PRESENTED)].map((m) => m[1]),
    ...[...reply.matchAll(BLOCK_QUOTE)].map((m) => m[1]),
  ]
    // A quoted passage is checked above, as a quote.
    .filter((t) => !/[“"][^”"]{12,}[”"]/.test(t))
    .map((t) => t.trim());
  for (const t of presented) {
    const n = normaliseForQuote(t);
    if (
      n.length >= SHORTEST_CHECKED &&
      !said.some((src) => src.includes(n)) &&
      !out.includes(t)
    ) {
      out.push(t);
    }
  }
  return out;
}
