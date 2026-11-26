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

  describe('only numbers reach a crisis reply (TF1 round 2, S-1)', () => {
    const SAATHI =
      '+91 20 4860 2525 (calls and WhatsApp chat on the same number). Open every day 10 am to 10 pm, including Sundays and public holidays. Closed on Diwali day (Lakshmi Puja) only. Calls are free from any n';

    it("a confirmed answer with hours in it gives only Saathi's number", () => {
      expect(
        crisisHelplines({
          helplineNumbers: SAATHI,
          helplineSource: 'template',
          helplineConfirmedAt: now.toISOString(),
        }),
      ).toBe('+91 20 4860 2525');
      expect(crisisHelplines({ helplineNumbers: SAATHI })).toBe(
        '+91 20 4860 2525',
      );
    });

    it('text with no number is never a helpline, and never waits for a confirm', () => {
      const text = {
        helplineNumbers: 'Open 10 am to 10 pm',
        helplineSource: 'owner' as const,
      };
      expect(crisisHelplines(text)).toBe('');
      expect(
        helplineNeedsConfirming({ ...text, helplineSource: 'template' }),
      ).toBe(false);
    });

    it('cleaning a stored value is not the owner confirming it', () => {
      const stored = {
        helplineNumbers: SAATHI,
        helplineSource: 'template' as const,
        helplineConfirmedAt: null,
      };
      expect(
        ownerHelplineFields(
          stored,
          { helplineNumbers: '+91 20 4860 2525' },
          now,
        ),
      ).toEqual({ helplineSource: 'template', helplineConfirmedAt: null });
    });
  });
});
