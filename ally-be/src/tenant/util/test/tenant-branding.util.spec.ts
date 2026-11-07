import {
  ALLY_BONE,
  ALLY_BRAND_PRIMARY,
} from '../../constants/tenant-branding.constants';
import {
  applyBrandingPatch,
  resolveBranding,
  validateBrandingPatch,
} from '../tenant-branding.util';

const ASSET =
  'https://ally-assets.s3.ap-south-1.amazonaws.com/org-branding/t1/favicon-abc-fav.png';

describe('validateBrandingPatch', () => {
  it('returns an empty patch for null and refuses a non-object', () => {
    expect(validateBrandingPatch(null)).toEqual({
      value: {},
      errors: [],
      warnings: [],
    });
    expect(validateBrandingPatch('x').errors).toEqual([
      'branding must be an object',
    ]);
  });

  it('drops unknown keys and never lets `enabled` through', () => {
    const { value, errors } = validateBrandingPatch({
      enabled: true,
      secondaryColor: '#000000',
      displayName: 'Acme',
    });
    expect(errors).toEqual([]);
    expect(value).toEqual({ displayName: 'Acme' });
  });

  it('trims text, treats empty as clear, and enforces lengths', () => {
    expect(validateBrandingPatch({ displayName: '  Acme  ' }).value).toEqual({
      displayName: 'Acme',
    });
    expect(validateBrandingPatch({ displayName: '   ' }).value).toEqual({
      displayName: null,
    });
    expect(validateBrandingPatch({ welcomeLine: null }).value).toEqual({
      welcomeLine: null,
    });
    const long = validateBrandingPatch({ displayName: 'x'.repeat(61) });
    expect(long.errors).toEqual(['displayName must be 60 characters or fewer']);
    expect(long.value).toEqual({});
    expect(validateBrandingPatch({ welcomeLine: 42 }).errors).toEqual([
      'welcomeLine must be text',
    ]);
  });

  it('accepts only assets-bucket favicon URLs', () => {
    expect(validateBrandingPatch({ faviconUrl: ASSET }).value).toEqual({
      faviconUrl: ASSET,
    });
    expect(validateBrandingPatch({ faviconUrl: '' }).value).toEqual({
      faviconUrl: null,
    });
    const bad = validateBrandingPatch({
      faviconUrl: 'https://evil.example/pixel.png',
    });
    expect(bad.errors[0]).toMatch(/favicon upload route/);
    expect(bad.value).toEqual({});
  });

  it('accepts only assets-bucket logo URLs, and null to remove', () => {
    expect(validateBrandingPatch({ logoUrl: ASSET }).value).toEqual({
      logoUrl: ASSET,
    });
    expect(validateBrandingPatch({ logoUrl: null }).value).toEqual({
      logoUrl: null,
    });
    const bad = validateBrandingPatch({
      logoUrl: 'https://evil.example/logo.png',
    });
    expect(bad.errors[0]).toMatch(/logo upload route/);
    expect(bad.value).toEqual({});
  });

  it('normalises a good colour and reports no warnings for Ally Blue', () => {
    const r = validateBrandingPatch({ primaryColor: '#264d8e' });
    expect(r.value).toEqual({ primaryColor: '#264D8E' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('refuses a colour that fails 3:1 on the page background, naming the fix', () => {
    const r = validateBrandingPatch({ primaryColor: '#F0EEE7' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/too close to the page background/);
    expect(r.errors[0]).toMatch(/Pick a darker or more saturated shade/);
    expect(r.value).toEqual({});
  });

  it('saves but warns a colour between 3:1 and 4.5:1', () => {
    // A mid orange: fine for buttons, weak as body text.
    const r = validateBrandingPatch({ primaryColor: '#CC5500' });
    expect(r.errors).toEqual([]);
    expect(r.value).toEqual({ primaryColor: '#CC5500' });
    expect(r.warnings.some((w) => /hard to read as text/.test(w))).toBe(true);
  });

  it('refuses a malformed colour and allows null to clear', () => {
    expect(validateBrandingPatch({ primaryColor: 'blue' }).errors).toEqual([
      'primaryColor must be a hex colour like #264D8E',
    ]);
    expect(validateBrandingPatch({ primaryColor: null }).value).toEqual({
      primaryColor: null,
    });
  });
});

describe('applyBrandingPatch', () => {
  it('lays the patch over the stored partial without touching `enabled`', () => {
    expect(
      applyBrandingPatch(
        { enabled: true, displayName: 'Old', welcomeLine: 'Hi' },
        { displayName: 'New', primaryColor: '#000000' },
      ),
    ).toEqual({
      enabled: true,
      displayName: 'New',
      welcomeLine: 'Hi',
      primaryColor: '#000000',
    });
  });
});

describe('resolveBranding', () => {
  const tenant = { name: 'Acme Org', logoUrl: 'https://x/logo.png' };

  it('is Ally defaults with the org name and logo when nothing is stored', () => {
    const r = resolveBranding(tenant, undefined);
    expect(r).toMatchObject({
      enabled: false,
      displayName: 'Acme Org',
      logoUrl: 'https://x/logo.png',
      faviconUrl: null,
      primaryColor: ALLY_BRAND_PRIMARY,
      welcomeLine: null,
      poweredByAlly: true,
    });
    expect(r.tokens.primary[500]).toBe(ALLY_BRAND_PRIMARY);
    expect(r.tokens.onPrimary).toBe(ALLY_BONE);
  });

  it('ignores stored values while the switch is off, but keeps them stored', () => {
    const stored = {
      enabled: false,
      displayName: 'Acme Helpline',
      primaryColor: '#8E2626',
      welcomeLine: 'Welcome',
    };
    const r = resolveBranding(tenant, stored);
    expect(r.enabled).toBe(false);
    expect(r.displayName).toBe('Acme Org');
    expect(r.primaryColor).toBe(ALLY_BRAND_PRIMARY);
    expect(r.welcomeLine).toBeNull();
    expect(stored.primaryColor).toBe('#8E2626');
  });

  it('applies stored values and derives the ramp when the switch is on', () => {
    const r = resolveBranding(tenant, {
      enabled: true,
      displayName: 'Acme Helpline',
      primaryColor: '#8E2626',
      welcomeLine: 'Welcome',
    });
    expect(r.enabled).toBe(true);
    expect(r.displayName).toBe('Acme Helpline');
    expect(r.primaryColor).toBe('#8E2626');
    expect(r.welcomeLine).toBe('Welcome');
    expect(r.tokens.primary[500]).toBe('#8E2626');
    expect(r.tokens.primary[50]).not.toBe('#8E2626');
  });

  it('falls back per field: a null stored value means the default', () => {
    const r = resolveBranding(tenant, {
      enabled: true,
      displayName: null,
      primaryColor: null,
    });
    expect(r.displayName).toBe('Acme Org');
    expect(r.primaryColor).toBe(ALLY_BRAND_PRIMARY);
  });

  it('never reports a logo for an org without one', () => {
    expect(
      resolveBranding({ name: 'N' }, { enabled: true }).logoUrl,
    ).toBeNull();
  });
});
