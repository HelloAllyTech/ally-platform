import type { DebriefAction, DebriefCan } from './debrief-console-roles.util';
import { alwaysAsk } from './debrief-always-ask.util';
import { changeKindOf } from './debrief-console-view.util';
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

export function isPinnedRuleChange(idea: {
  change?: Record<string, any> | null;
}): boolean {
  const change = idea.change ?? {};
  return (
    change.ideaKind === 'pinned_rule' || changeKindOf(change) === 'pinned_rules'
  );
}

/**
 * Who may carry out an action on this change (debrief-console-roles.util.ts):
 * a pinned-rule decision is the clinical advisor's or the owner's, a budget
 * increase the owner's, everything else the PM agent permission's.
 */
export function requiredAction(
  idea: {
    change?: Record<string, any> | null;
    evidence?: Record<string, any> | null;
  },
  decision: boolean,
): DebriefAction {
  // The core's always-ask list (debrief-always-ask.util.ts), its locked kinds only.
  const kind = alwaysAsk(idea, {
    askLowConfidence: false,
    askModels: false,
  })?.kind;
  if (
    decision &&
    (isPinnedRuleChange(idea) ||
      kind === 'pinned_rule' ||
      kind === 'safety_reader')
  ) {
    return 'approvePinnedRule';
  }
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
  switch (action) {
    case 'approvePinnedRule':
      return 'the clinical advisor or the owner';
    case 'ownerSettings':
      return 'the owner';
    default:
      return 'the Ally team or the owner';
  }
}

/** May this viewer read and post in the conversation, and how much of it? */
export function conversationAccess(
  can: Pick<DebriefCan, 'pmAgent' | 'approvePinnedRule'>,
): 'all' | 'pinned_rules' | 'none' {
  if (can.pmAgent) return 'all';
  if (can.approvePinnedRule) return 'pinned_rules';
  return 'none';
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
