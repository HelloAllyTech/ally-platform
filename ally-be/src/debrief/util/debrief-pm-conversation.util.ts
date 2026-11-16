import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import type { DebriefAction, DebriefCan } from './debrief-console-roles.util';
import { changeKindOf, PINNED_RULE_CODES } from './debrief-console-view.util';
import type {
  DebriefPmMessage,
  PmAbout,
  PmAction,
} from '../entity/debrief-pm-message.entity';

/**
 * The PM agent conversation's rules that need no database (V2_AUTONOMY C1–C3):
 * what counts as a yes, which changes always ask a person and why, who may
 * carry out an action, and the contract's `PmMessage`.
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

/**
 * Why a change always waits for a person (V2_AUTONOMY A1), in plain words; []
 * when it does not. The four locked kinds always ask; low confidence asks
 * while `askLowConfidence` is on (default on); a new model or provider while
 * `askModels` is on (default off). Settings are read defensively: the keys may
 * not exist yet.
 */
export function alwaysAskReasons(
  idea: {
    change?: Record<string, any> | null;
    evidence?: Record<string, any> | null;
  },
  settings: Record<string, unknown> = {},
): string[] {
  const change = idea.change ?? {};
  const out: string[] = [];
  const code = typeof change.promptCode === 'string' ? change.promptCode : '';
  if (code === DEBRIEF_PROMPT_CODES.safetyReader) {
    out.push('It changes the Safety reader.');
  } else if (
    change.ideaKind === 'pinned_rule' ||
    changeKindOf(change) === 'pinned_rules' ||
    PINNED_RULE_CODES.has(code)
  ) {
    out.push('It changes a pinned rule.');
  }
  if (/crisis|support_line|helpline/i.test(code)) {
    out.push('It changes crisis lines or support copy.');
  }
  if (change.budgetOnly || change.budgetIncrease) {
    out.push('It raises a budget.');
  }
  const askLow = settings.askLowConfidence !== false;
  if (askLow && idea.evidence?.confidence?.level === 'low') {
    out.push('The PM agent is not sure it helps (low confidence).');
  }
  if (
    settings.askModels === true &&
    (change.ideaKind === 'model' || change.model)
  ) {
    out.push('It brings in a new model or provider.');
  }
  return out;
}

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
  idea: { change?: Record<string, any> | null },
  decision: boolean,
): DebriefAction {
  if (decision && isPinnedRuleChange(idea)) return 'approvePinnedRule';
  if (idea.change?.budgetOnly || idea.change?.budgetIncrease) {
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
