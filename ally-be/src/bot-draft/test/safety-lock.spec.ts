import { SafetyPackId } from '../enum/bot-draft.enum';
import {
  assertDraftKeepsPack,
  assertSettingsKeepPack,
  SafetyLockedError,
} from '../safety-pack/safety-lock';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import { BotDraftService } from '../service/bot-draft.service';

const draft = (
  pack: SafetyPackId,
  disclaimer = SAFETY_PACKS[pack].disclaimer ?? '',
) => {
  const d = BotDraftService.defaultDraft('Sunrise Mind');
  return { ...d, safetyPackId: pack, branding: { ...d.branding, disclaimer } };
};

describe('the safety lock', () => {
  it('refuses a weaker pack, and dropping the disclaimer', () => {
    const before = draft(SafetyPackId.MENTAL_HEALTH);
    expect(() =>
      assertDraftKeepsPack(before, {
        ...before,
        safetyPackId: SafetyPackId.STANDARD,
      }),
    ).toThrow(SafetyLockedError);
    expect(() =>
      assertDraftKeepsPack(before, {
        ...before,
        branding: { ...before.branding, disclaimer: '' },
      }),
    ).toThrow(SafetyLockedError);
  });

  it("allows adding: a stronger pack, a longer disclaimer, the owner's own rules", () => {
    const before = draft(SafetyPackId.STANDARD);
    expect(() =>
      assertDraftKeepsPack(before, draft(SafetyPackId.MEDICAL)),
    ).not.toThrow();
    const health = draft(SafetyPackId.MEDICAL);
    expect(() =>
      assertDraftKeepsPack(health, {
        ...health,
        extraNever: ['quote surgery prices'],
        branding: {
          ...health.branding,
          disclaimer: `${health.branding.disclaimer} Call us on 022.`,
        },
      }),
    ).not.toThrow();
  });

  it('refuses turning the crisis classifier off on a health pack, not on others', () => {
    expect(() =>
      assertSettingsKeepPack(SafetyPackId.MENTAL_HEALTH, {
        crisisClassifierEnabled: false,
      }),
    ).toThrow(SafetyLockedError);
    expect(() =>
      assertSettingsKeepPack(SafetyPackId.STANDARD, {
        crisisClassifierEnabled: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertSettingsKeepPack(null, { crisisClassifierEnabled: false }),
    ).not.toThrow();
  });
});
