import en from '../en.json';

describe('localization locales', () => {
  it('has required top-level keys in en.json', () => {
    expect(typeof en).toBe('object');
    expect(en.common).toBeTruthy();
    expect(en.calls).toBeTruthy();
    expect(en.locationDropdown).toBeTruthy();
  });

  it('has non-empty strings for some critical keys', () => {
    expect(en.common.ok).toMatch(/\w/);
    expect(en.callSummary.customMenu.export).toMatch(/Export/);
    expect(en.auth.login.greetingLine1).toMatch(/Hey/);
  });
});


