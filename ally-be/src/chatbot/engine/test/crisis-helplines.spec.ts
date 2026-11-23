import {
  crisisHelplines,
  helplineNeedsConfirming,
  ownerHelplineFields,
} from '../crisis-helplines';

describe('crisis helplines (Q4 G7)', () => {
  const now = new Date('2026-11-22T10:00:00Z');

  it("a template's number is not used in crisis replies until the owner confirms it", () => {
    const template = {
      helplineNumbers: '9920805299',
      helplineSource: 'template' as const,
      helplineConfirmedAt: null,
    };
    expect(crisisHelplines(template)).toBe('');
    expect(helplineNeedsConfirming(template)).toBe(true);
    expect(
      crisisHelplines({ ...template, helplineConfirmedAt: now.toISOString() }),
    ).toBe('9920805299');
  });

  it("the owner's own number, and numbers saved before Q4, are used", () => {
    expect(
      crisisHelplines({
        helplineNumbers: '1800 123 4567',
        helplineSource: 'owner',
      }),
    ).toBe('1800 123 4567');
    expect(crisisHelplines({ helplineNumbers: '9152987821' })).toBe(
      '9152987821',
    );
    expect(crisisHelplines({ helplineNumbers: '  ' })).toBe('');
  });

  it("the owner's save confirms a changed number, or one they confirm", () => {
    const stored = {
      helplineNumbers: '9920805299',
      helplineSource: 'template' as const,
      helplineConfirmedAt: null,
    };
    // Saving another setting keeps it unconfirmed.
    expect(
      ownerHelplineFields(stored, { helplineNumbers: '9920805299' }, now),
    ).toEqual({ helplineSource: 'template', helplineConfirmedAt: null });
    // "Use this number in crisis replies".
    expect(
      ownerHelplineFields(
        stored,
        { helplineNumbers: '9920805299', helplineConfirm: true },
        now,
      ),
    ).toEqual({
      helplineSource: 'owner',
      helplineConfirmedAt: now.toISOString(),
    });
    // A number the owner typed.
    expect(
      ownerHelplineFields(stored, { helplineNumbers: '+91 22 2552 1111' }, now),
    ).toEqual({
      helplineSource: 'owner',
      helplineConfirmedAt: now.toISOString(),
    });
    // Cleared.
    expect(ownerHelplineFields(stored, { helplineNumbers: '' }, now)).toEqual({
      helplineSource: null,
      helplineConfirmedAt: null,
    });
  });
});
