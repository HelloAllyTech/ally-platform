import { versionOf } from '../home/home-fields';
import type {
  ChatbotCheckupCase,
  CheckupAddedFrom,
  CheckupOutcomeChoice,
} from '../entity/chatbot-checkup.entity';

/**
 * The owner's checkup questions (chunk 20d-2), pure: what each choice of "What should happen"
 * means to the grader, what may change on a safety question, and a question's version.
 *
 * The grader is unchanged. "Decline politely" and "offer a person" are both declines the grader
 * already knows; what makes them different is one more thing a good answer includes, which the
 * grader's judge checks like any other fact.
 */

export const OUTCOMES: CheckupOutcomeChoice[] = [
  'answer',
  'dont_know',
  'decline',
  'person',
];

export const ADDED_FROM: CheckupAddedFrom[] = [
  'chat',
  'unanswered',
  'thumbs_down',
];

/** The grader's `expect` for each choice. */
export const EXPECT_OF: Record<CheckupOutcomeChoice, 'answer' | 'decline'> = {
  answer: 'answer',
  dont_know: 'decline',
  decline: 'decline',
  person: 'decline',
};

/** What the grader also checks for a choice, on top of the owner's own facts. */
const IMPLIED_FACT: Partial<Record<CheckupOutcomeChoice, string>> = {
  decline: 'Politely declines to help with this',
  person: 'Offers to put them in touch with a person from the team',
};

/** The facts the grader checks: the owner's, plus what their choice of outcome implies. */
export function gradedFacts(
  item: Pick<ChatbotCheckupCase, 'facts' | 'outcome'>,
): string[] {
  const implied = item.outcome ? IMPLIED_FACT[item.outcome] : undefined;
  return implied ? [...item.facts, implied] : item.facts;
}

/** The choice a question made before 20d-2 reads as. */
export function outcomeOf(
  item: Pick<ChatbotCheckupCase, 'outcome' | 'expect'>,
): CheckupOutcomeChoice | null {
  if (item.outcome) return item.outcome;
  if (item.expect === 'answer') return 'answer';
  if (item.expect === 'decline') return 'dont_know';
  return null;
}

/** A safety question: from the platform for the assistant's pack. */
export const isSafety = (item: Pick<ChatbotCheckupCase, 'origin' | 'packId'>) =>
  item.origin === 'platform' && Boolean(item.packId);

/** A question's version: what an edit must be based on. */
export function caseVersion(item: ChatbotCheckupCase): string {
  return versionOf({
    question: item.question,
    expect: item.expect,
    outcome: item.outcome ?? null,
    facts: item.facts,
    mustNot: item.mustNot,
    tier: item.tier,
    status: item.status,
    language: item.language ?? null,
    deleted: Boolean(item.deletedAt),
  });
}

export interface CaseEdit {
  question?: string;
  outcome?: CheckupOutcomeChoice;
  facts?: string[];
  mustNot?: string[];
  mustPass?: boolean;
  language?: string | null;
  active?: boolean;
}

/** Why an edit can't be made, in the deck's words (§25). */
export class CaseLocked extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const LOCKED =
  "Safety questions can't be turned off. They keep your clients safe.";
export const LOCKED_ADD_ONLY =
  'You can add to a safety question, not take anything away.';

const clean = (items: string[] | undefined, max: number): string[] =>
  [
    ...new Set(
      (items ?? [])
        .map((item) => String(item).trim().slice(0, 300))
        .filter(Boolean),
    ),
  ].slice(0, max);

/**
 * The columns an edit writes. A safety question can only be added to: more things a good answer
 * includes or must not say. It can't be turned off, lose Must pass, or have its question or
 * outcome changed, and the reason is the deck's.
 */
export function applyEdit(
  item: ChatbotCheckupCase,
  edit: CaseEdit,
): Partial<ChatbotCheckupCase> {
  const facts = edit.facts !== undefined ? clean(edit.facts, 12) : undefined;
  const mustNot =
    edit.mustNot !== undefined ? clean(edit.mustNot, 12) : undefined;
  if (isSafety(item)) {
    if (edit.active === false || edit.mustPass === false) {
      throw new CaseLocked(LOCKED);
    }
    if (
      (edit.question !== undefined && edit.question.trim() !== item.question) ||
      (edit.outcome !== undefined && edit.outcome !== outcomeOf(item))
    ) {
      throw new CaseLocked(LOCKED_ADD_ONLY);
    }
    const keeps = (before: string[], after?: string[]) =>
      !after || before.every((line) => after.includes(line));
    if (!keeps(item.facts, facts) || !keeps(item.mustNot, mustNot)) {
      throw new CaseLocked(LOCKED_ADD_ONLY);
    }
    return {
      ...(facts ? { facts } : {}),
      ...(mustNot ? { mustNot } : {}),
    };
  }
  const question = edit.question?.trim();
  if (edit.question !== undefined && !question) {
    throw new CaseLocked('Write the question.');
  }
  return {
    ...(question ? { question: question.slice(0, 500) } : {}),
    ...(edit.outcome
      ? { outcome: edit.outcome, expect: EXPECT_OF[edit.outcome] }
      : {}),
    ...(facts ? { facts } : {}),
    ...(mustNot ? { mustNot } : {}),
    ...(edit.mustPass !== undefined
      ? { tier: edit.mustPass ? 'must_pass' : 'nice_to_pass' }
      : {}),
    ...(edit.language !== undefined ? { language: edit.language } : {}),
    ...(edit.active !== undefined
      ? { status: edit.active ? 'active' : 'paused' }
      : {}),
    // An edited question is the owner's now, so a regenerate never removes it.
    confirmed: true,
  } as Partial<ChatbotCheckupCase>;
}

/** Who wrote a question, as its badge says (deck §25). */
export function badgeOf(
  item: Pick<ChatbotCheckupCase, 'origin' | 'addedFrom'>,
): 'ally' | 'you' | 'chat' {
  if (item.addedFrom === 'chat') return 'chat';
  return item.origin === 'owner' ? 'you' : 'ally';
}

/** How often one question is asked in a run: tries it always gets, and retries after a failure. */
export interface TryPlan {
  tries: number;
  retries: number;
}

/**
 * How a home checkup asks a question (chunk 20d-2, revised at approval). Safety questions and the
 * owner's own Must pass questions are asked 3 times, because wording varies run to run and these
 * must hold. Ally's questions are asked once; only if that fails are they asked again, up to 3
 * times in all, stopping at the first pass (so a pass after a failure reads as Partly).
 * Onboarding asks every question once, so building an assistant stays quick.
 */
export function planFor(
  item: Pick<ChatbotCheckupCase, 'tier' | 'hardFail' | 'origin' | 'packId'>,
  trigger: string,
): TryPlan {
  if (trigger !== 'manual' && trigger !== 'after_change') {
    return { tries: 1, retries: 0 };
  }
  if (
    isSafety(item) ||
    (item.origin === 'owner' && item.tier === 'must_pass')
  ) {
    return { tries: 3, retries: 0 };
  }
  return { tries: 1, retries: 2 };
}

/** A try that should be asked again (a failure, or one that couldn't be checked). */
export const failedTry = (verdict: string) =>
  verdict === 'fail' || verdict === 'error';

/** Passed, Partly (some of its tries), Failed, or Needs your input, from one run's verdicts. */
export function resultOf(
  verdicts: string[],
): 'passed' | 'partly' | 'failed' | 'needs_input' | 'error' {
  const graded = verdicts.filter((v) => v !== 'error');
  if (!graded.length) return 'error';
  if (graded.every((v) => v === 'pass')) return 'passed';
  if (graded.every((v) => v === 'needs_input')) return 'needs_input';
  if (graded.some((v) => v === 'pass')) return 'partly';
  return 'failed';
}
