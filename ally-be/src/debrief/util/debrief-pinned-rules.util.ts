import { createHash } from 'crypto';
import { PINNED_RULE_PROMPTS } from './debrief-console-view.util';

/**
 * Pinned rules' approval flow (debrief-console-redesign-notes.md, "Pinned
 * rules: approval flow", 2026-11-12): first-version items, the whole rule with
 * the changed passage highlighted, and which buttons each item carries.
 */

/** A rule's name without its explanation: "Rubric (the Evaluator…)" → "Rubric". */
export function pinnedRuleName(code: string): string {
  const label = PINNED_RULE_PROMPTS.find((p) => p.code === code)?.label;
  return label ? label.split(' (')[0] : code;
}

/** "Approve the current Safety rules (v1)". */
export function firstVersionTitle(code: string, version: number): string {
  return `Approve the current ${pinnedRuleName(code)} (v${version})`;
}

/** One first-version item per rule and version, whoever asks and however often. */
export function firstVersionHash(code: string, version: number): string {
  return createHash('sha256')
    .update(`pinned_rule_first_version:${code}:v${version}`)
    .digest('hex');
}

/** Why a passage can't be the find of a proposal, in words for the person proposing. */
export function passageProblem(
  live: string,
  find: string,
): 'empty' | 'not_found' | 'not_unique' | null {
  if (!find || !find.trim()) return 'empty';
  const first = live.indexOf(find);
  if (first < 0) return 'not_found';
  if (live.indexOf(find, first + 1) >= 0) return 'not_unique';
  return null;
}

export const PASSAGE_PROBLEM_MESSAGE: Record<
  'empty' | 'not_found' | 'not_unique',
  string
> = {
  empty: 'Select the passage to change in the rule, or paste it.',
  not_found:
    'That passage is not in the current rule. Select it in the text, or paste it exactly as it reads.',
  not_unique:
    'That passage appears more than once in the rule. Select a longer passage, so it is found only once.',
};

/** The rule split into plain and highlighted runs, in order. */
export interface RuleSegment {
  text: string;
  changed: boolean;
}

/**
 * The whole rule as it would read after the change, with the replacement
 * highlighted. `stale`: the passage is no longer in the live text (the rule
 * changed since), so only the live text is returned, nothing highlighted.
 */
export function textAfterChange(
  live: string,
  find: string | null | undefined,
  replace: string | null | undefined,
): { segments: RuleSegment[]; stale: boolean } {
  if (!find)
    return { segments: [{ text: live, changed: false }], stale: false };
  const at = live.indexOf(find);
  if (at < 0) {
    return { segments: [{ text: live, changed: false }], stale: true };
  }
  const segments: RuleSegment[] = [
    { text: live.slice(0, at), changed: false },
    { text: replace ?? '', changed: true },
    { text: live.slice(at + find.length), changed: false },
  ].filter((s) => s.changed || s.text.length > 0);
  return { segments, stale: false };
}

/**
 * What a viewer may do on a pinned-rule item (the notes' button table):
 * - a first version: Approve · Ask for a change (no Reject: a base must exist);
 * - the viewer's own proposal: Approve · Withdraw;
 * - a proposal from the PM agent or another person: Approve · Reject · Ask for a change.
 * Only the clinical advisor or the owner (`approvePinnedRule`) acts at all.
 */
export function pinnedRuleActions(i: {
  open: boolean;
  firstVersion: boolean;
  mine: boolean;
  mayDecide: boolean;
}): {
  approve: boolean;
  reject: boolean;
  withdraw: boolean;
  askForChange: boolean;
} {
  const may = i.open && i.mayDecide;
  return {
    approve: may,
    reject: may && !i.firstVersion && !i.mine,
    withdraw: may && !i.firstVersion && i.mine,
    askForChange: may && (i.firstVersion || !i.mine),
  };
}
