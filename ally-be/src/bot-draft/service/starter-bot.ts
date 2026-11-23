import { LearnedSection } from '../enum/bot-draft.enum';
import type { BotDraft, LearnedFact, PatchOp } from '../type/bot-draft.type';

/**
 * SB1 step 2: a starter assistant a few seconds after the first pages are read. Nothing here calls a
 * model. It fills only what the owner and the builder have not written yet, from what was actually
 * read, so the first chat already greets by name and offers questions it can answer. The builder's
 * full draft later replaces these, and anything the owner typed is never touched.
 *
 * TEXT NEEDS APPROVAL: these strings are product copy. They live here, not in the approved copy
 * deck's checked set, until someone signs them off (see CHUNK-SB1-NOTES.md).
 */
export const STARTER_COPY = {
  greeting: (name: string) =>
    `Hi, I'm the assistant for ${name}. What would you like to know?`,
  /** One chip per kind of detail found, in this order. Only kinds with a fact behind them. */
  questions: [
    [LearnedSection.ABOUT, 'What do you do?'],
    [LearnedSection.SERVICES, 'What do you offer, and what does it cost?'],
    [LearnedSection.HOURS, 'What are your opening hours?'],
    [LearnedSection.LOCATION, 'Where are you?'],
    [LearnedSection.TEAM, 'Who is on your team?'],
    [LearnedSection.POLICIES, 'What are your policies?'],
  ] as const,
};

/** The greeting this module wrote earlier, so a better business name can refresh it. */
const STARTER_GREETING =
  /^Hi, I'm the assistant for .+\. What would you like to know\?$/;

/** How many starter questions to offer (the page shows a handful). */
export const STARTER_MAX_QUESTIONS = 4;

/**
 * The patch that makes a draft a starter assistant: a greeting using the business name when there
 * is none, and question chips for the kinds of detail found when there are none. Empty when there
 * is nothing to fill.
 */
export function starterOps(
  config: Pick<
    BotDraft,
    'assistantName' | 'introduction' | 'suggestedQuestions'
  >,
  facts: Pick<LearnedFact, 'section'>[],
): PatchOp[] {
  const ops: PatchOp[] = [];
  const given = config.assistantName.trim();
  // The placeholder a setup starts with (a description gives no name) is not a name to greet by.
  const name = /^your (?:business|assistant)$/i.test(given) ? '' : given;
  const intro = config.introduction.trim();
  const greeting = name ? STARTER_COPY.greeting(name) : '';
  // Fill an empty greeting, or refresh our own earlier one when the name has since improved.
  // A greeting anyone else wrote is never touched.
  if (
    greeting &&
    (!intro || (STARTER_GREETING.test(intro) && intro !== greeting))
  ) {
    ops.push({ op: 'replace', path: '/introduction', value: greeting });
  }
  if (!config.suggestedQuestions.length) {
    const found = new Set(facts.map((fact) => fact.section));
    const questions = STARTER_COPY.questions
      .filter(([section]) => found.has(section))
      .map(([, text]) => text)
      .slice(0, STARTER_MAX_QUESTIONS);
    if (questions.length) {
      ops.push({
        op: 'replace',
        path: '/suggestedQuestions',
        value: [...questions],
      });
    }
  }
  return ops;
}
