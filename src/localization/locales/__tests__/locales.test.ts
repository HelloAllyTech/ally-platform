import en from '../en.json';

describe('localization locales', () => {
  it('has required top-level keys in en.json', () => {
    expect(typeof en).toBe('object');
    expect(en.Common).toBeTruthy();
    expect(en.CallLogs).toBeTruthy();
    expect(en.LocationDropdown).toBeTruthy();
  });

  it('has non-empty strings for some critical keys', () => {
    expect(en.Common.ok).toMatch(/\w/);
    expect(en.CallSummary.customMenu.export).toMatch(/Export/);
    expect(en.SplashScreen.hey).toMatch(/Hey/);
  });
});


