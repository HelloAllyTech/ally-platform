import { PINNED_RULE_PROMPTS } from './debrief-console-view.util';

/**
 * Display helpers for pinned-rule changes already in the history. Pinned rules are no longer
 * proposed or approved in the console (they are edited in the Skills Store by the named pinned
 * editors), so these only read what past changes recorded.
 */

/** A rule's name without its explanation: "Rubric (the Evaluator…)" → "Rubric". */
export function pinnedRuleName(code: string): string {
  const label = PINNED_RULE_PROMPTS.find((p) => p.code === code)?.label;
  return label ? label.split(' (')[0] : code;
}

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
