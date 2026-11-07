import { BotDraftStep } from '../enum/bot-draft.enum';

/**
 * The onboarding steps in order, as data, so later loops add steps here (20a-2 inserts `checkup`
 * and `try_it` before `share`) rather than in code paths.
 */
export const STEP_ORDER: readonly BotDraftStep[] = [
  BotDraftStep.START,
  BotDraftStep.READING,
  BotDraftStep.LEARNED,
  BotDraftStep.SAFETY,
  BotDraftStep.GAPS,
  BotDraftStep.DESIGN,
  BotDraftStep.BUILDING,
  BotDraftStep.SHARE,
  BotDraftStep.PUBLISHED,
];

/** The steps a description-only or upload-only draft skips. */
export const STEPS_WITHOUT_WEBSITE: readonly BotDraftStep[] = [
  BotDraftStep.READING,
];

export function stepIndex(step: BotDraftStep): number {
  return STEP_ORDER.indexOf(step);
}

/**
 * Whether the builder (or the owner) may go from `from` to `to`: staying put, or moving one step
 * forward. Skipping ahead, or going back, is the server's call (Back is its own route).
 */
export function canAdvance(from: BotDraftStep, to: BotDraftStep): boolean {
  if (from === to) return true;
  const a = stepIndex(from);
  const b = stepIndex(to);
  return a >= 0 && b === a + 1 && to !== BotDraftStep.PUBLISHED;
}

/** One step back, never before `learned` once reading has happened, and never from published. */
export function previousStep(step: BotDraftStep): BotDraftStep {
  const index = stepIndex(step);
  if (
    index <= stepIndex(BotDraftStep.LEARNED) ||
    step === BotDraftStep.PUBLISHED
  ) {
    return step;
  }
  return STEP_ORDER[index - 1];
}

export function nextStep(step: BotDraftStep): BotDraftStep {
  const index = stepIndex(step);
  return index < 0 || index >= STEP_ORDER.length - 1
    ? step
    : STEP_ORDER[index + 1];
}
