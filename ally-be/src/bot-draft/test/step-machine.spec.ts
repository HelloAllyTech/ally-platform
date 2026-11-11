import { BotDraftStep as S } from '../enum/bot-draft.enum';
import { canAdvance, nextStep, previousStep } from '../service/step-machine';

describe('the step machine', () => {
  it('moves one step forward at a time, never into published by itself', () => {
    expect(canAdvance(S.LEARNED, S.SAFETY)).toBe(true);
    expect(canAdvance(S.LEARNED, S.LEARNED)).toBe(true);
    expect(canAdvance(S.LEARNED, S.DESIGN)).toBe(false);
    expect(canAdvance(S.SAFETY, S.LEARNED)).toBe(false);
    expect(canAdvance(S.SHARE, S.PUBLISHED)).toBe(false);
    expect(nextStep(S.BUILDING)).toBe(S.SHARE);
  });

  it('goes back one step, but not before what was learned, and not from published', () => {
    expect(previousStep(S.DESIGN)).toBe(S.GAPS);
    expect(previousStep(S.SAFETY)).toBe(S.LEARNED);
    expect(previousStep(S.LEARNED)).toBe(S.LEARNED);
    expect(previousStep(S.PUBLISHED)).toBe(S.PUBLISHED);
  });
});
