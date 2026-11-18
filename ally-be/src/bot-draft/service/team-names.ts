import { LearnedSection } from '../enum/bot-draft.enum';
import type { LearnedFact } from '../type/bot-draft.type';

/** Words that open a team fact but aren't a name ("Our team…", "We have…"). */
const NOT_A_NAME = /^(our|the|we|they|all|each|every|team|staff|members?)\b/i;

/**
 * The team members' names from what onboarding learned (chunk 20d's Team photos): the part of each
 * Team fact before " is ", " - ", " – ", "," or "(" ("Dr Kavya Iyer is Clinical Psychologist…" →
 * "Dr Kavya Iyer"). Facts that don't start with a short name are skipped; names are unique, in
 * the order learned.
 */
export function teamNames(
  facts: Pick<LearnedFact, 'section' | 'text'>[],
): string[] {
  const names: string[] = [];
  for (const fact of facts) {
    if (fact.section !== LearnedSection.TEAM) continue;
    const head =
      fact.text
        .split(/\s+(?:is|was|leads|runs)\s+|\s[-–—]\s|[,(:]/)[0]
        ?.trim() ?? '';
    const words = head.split(/\s+/).filter(Boolean);
    if (!head || words.length < 2 || words.length > 5 || NOT_A_NAME.test(head))
      continue;
    if (
      !words.every(
        (w) => /^[A-Z][\p{L}.'-]*$/u.test(w) || /^(?:Dr|Mr|Ms|Mrs)\.?$/.test(w),
      )
    ) {
      continue;
    }
    if (!names.includes(head)) names.push(head);
  }
  return names.slice(0, 50);
}
