import { PINNED_RULE_PROMPTS } from './debrief-console-view.util';

/** A rule's name without its explanation: "Rubric (the Evaluator…)" → "Rubric". */
export function pinnedRuleName(code: string): string {
  const label = PINNED_RULE_PROMPTS.find((p) => p.code === code)?.label;
  return label ? label.split(' (')[0] : code;
}
