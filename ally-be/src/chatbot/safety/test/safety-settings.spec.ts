import {
  SAFETY_DEFAULTS,
  loosensSafetySetting,
  safetySettingsOf,
  validateSafetySettings,
} from '../safety-settings';
import {
  changesAdminOnlySetting,
  cleanOverride,
} from '../../service/chatbot-settings.service';

describe('safety settings', () => {
  it('fills every default, strictest audience first', () => {
    const s = safetySettingsOf(undefined);
    expect(s).toMatchObject({
      audienceAge: 'unstated',
      retentionDays: 90,
      noAnswerMode: 'say_unknown_offer_person',
      waitBeforeNoOneAvailableMinutes: 10,
      crisisResumeRule: 'never',
      timeZone: 'Asia/Kolkata',
      alertPolicy: { mode: 'immediate' },
    });
    expect(s).toEqual(SAFETY_DEFAULTS);
  });

  it('falls back to the default for a stored value out of range', () => {
    const s = safetySettingsOf({
      retentionDays: 1,
      waitBeforeNoOneAvailableMinutes: 500,
      audienceAge: 'kids',
      alertPolicy: { mode: 'off' },
    } as never);
    expect(s.retentionDays).toBe(90);
    expect(s.waitBeforeNoOneAvailableMinutes).toBe(10);
    expect(s.audienceAge).toBe('unstated');
    expect(s.alertPolicy.mode).toBe('immediate');
  });

  it.each([
    [{ retentionDays: 6 }, /7 to 365/],
    [{ retentionDays: 366 }, /7 to 365/],
    [{ retentionDays: 7 }, null],
    [{ retentionDays: 365 }, null],
    [{ waitBeforeNoOneAvailableMinutes: 1 }, /2 to 120/],
    [{ waitBeforeNoOneAvailableMinutes: 121 }, /2 to 120/],
    [{ waitBeforeNoOneAvailableMinutes: 2 }, null],
    [{ audienceAge: 'teens' }, /audienceAge/],
    [{ crisisResumeRule: 'always' }, /crisisResumeRule/],
    [{ noAnswerMode: 'x' }, /noAnswerMode/],
    [{ enabledLanguages: ['en', 'hi'] }, null],
    [{ enabledLanguages: 'en' }, /enabledLanguages/],
    [{ enabledLanguages: ['not a tag!'] }, /enabledLanguages/],
    [{ timeZone: 'Mars/Base' }, /timeZone/],
    [{ timeZone: 'Asia/Kolkata' }, null],
    [{ archivedMessage: 'x'.repeat(601) }, /archivedMessage/],
  ])('validates %j', (input, error) => {
    const out = validateSafetySettings(input as never);
    if (error) expect(out).toMatch(error);
    else expect(out).toBeNull();
  });

  it('never allows alerts off or zero immediate recipients', () => {
    expect(
      validateSafetySettings({ alertPolicy: { mode: 'off' } } as never),
    ).toMatch(/cannot be switched off/);
    expect(
      validateSafetySettings({
        alertPolicy: { mode: 'immediate', recipients: [] },
      }),
    ).toMatch(/at least one recipient/);
    expect(
      validateSafetySettings({
        alertPolicy: { mode: 'digest', recipients: [] },
      }),
    ).toBeNull();
    expect(
      validateSafetySettings({ alertPolicy: { mode: 'immediate' } }),
    ).toBeNull();
    expect(
      validateSafetySettings({
        alertPolicy: { mode: 'immediate', recipients: ['not-an-email'] },
      }),
    ).toMatch(/email/);
  });

  it('treats loosening as an owner change and tightening as an editor change', () => {
    expect(loosensSafetySetting({}, { audienceAge: 'adults' })).toBe(true);
    expect(loosensSafetySetting({}, { retentionDays: 120 })).toBe(true);
    expect(loosensSafetySetting({}, { retentionDays: 30 })).toBe(false);
    expect(loosensSafetySetting({}, { crisisResumeRule: 'after_idle' })).toBe(
      true,
    );
    expect(loosensSafetySetting({}, { alertPolicy: { mode: 'digest' } })).toBe(
      true,
    );
    expect(
      loosensSafetySetting({ retentionDays: 200 }, { retentionDays: 30 }),
    ).toBe(false);
    expect(changesAdminOnlySetting({}, { audienceAge: 'adults' })).toBe(true);
    expect(changesAdminOnlySetting({}, { declineText: 'x' })).toBe(false);
  });

  it('keeps a list setting as a list through cleanOverride', () => {
    expect(
      cleanOverride({ enabledLanguages: ['en', 'hi'], retentionDays: 30 }),
    ).toEqual({ enabledLanguages: ['en', 'hi'], retentionDays: 30 });
    expect(cleanOverride({ enabledLanguages: [] })).toEqual({});
  });
});
