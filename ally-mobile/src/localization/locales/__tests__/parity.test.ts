import en from '../en.json';
import hi from '../hi.json';
import kn from '../kn.json';
import mr from '../mr.json';
import ta from '../ta.json';

type Json = string | number | boolean | null | {[key: string]: Json} | Json[];

const LOCALES: Record<string, Json> = {hi, kn, mr, ta};

/**
 * Keys whose value is legitimately the same in every language: proper nouns,
 * a domain, a bare interpolation, and a dev-only marker. Anything NOT listed
 * here that matches English is untranslated content, not a translation.
 */
const ALLOWED_IDENTICAL = new Set([
  'common.appName', // "Ally"
  'auth.login.helloAlly', // "helloally.ai"
  'simulations.header.title', // "Ally"
  'review.details.callTitle', // "CALL-{{id}}" — record identifier
  'review.feedCard.reviewType', // "{{reviewType}}" — bare interpolation
  'drawer.dev', // "(Dev)" — dev-build marker
  'TermsAndAgreement.sections.generalTerms.bullets.crisisLink', // "https://findahelpline.com/"
]);

const flatten = (node: Json, prefix = '', out: Record<string, Json> = {}) => {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = node;
  }
  return out;
};

const PLACEHOLDER = /\{\{[^}]+\}\}/g;

const flatEn = flatten(en as Json);

describe('locale parity with en.json', () => {
  it.each(Object.keys(LOCALES))('%s has every key en.json has', lang => {
    const missing = Object.keys(flatEn).filter(
      key => !(key in flatten(LOCALES[lang])),
    );
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s has no key en.json lacks', lang => {
    const extra = Object.keys(flatten(LOCALES[lang])).filter(
      key => !(key in flatEn),
    );
    expect(extra).toEqual([]);
  });

  it.each(Object.keys(LOCALES))(
    '%s preserves every {{placeholder}} from en.json',
    lang => {
      const flat = flatten(LOCALES[lang]);
      const broken = Object.entries(flatEn)
        .filter(
          ([key, value]) =>
            typeof value === 'string' && typeof flat[key] === 'string',
        )
        .map(([key, value]) => ({
          key,
          expected: ((value as string).match(PLACEHOLDER) ?? []).sort(),
          actual: ((flat[key] as string).match(PLACEHOLDER) ?? []).sort(),
        }))
        .filter(
          ({expected, actual}) =>
            expected.join('|') !== actual.join('|'),
        )
        .map(({key}) => key);

      expect(broken).toEqual([]);
    },
  );

  it.each(Object.keys(LOCALES))(
    '%s does not ship English text as a translation',
    lang => {
      const flat = flatten(LOCALES[lang]);
      const untranslated = Object.entries(flatEn)
        .filter(([key, value]) => {
          if (ALLOWED_IDENTICAL.has(key)) return false;
          if (typeof value !== 'string' || value.trim() === '') return false;
          return flat[key] === value;
        })
        .map(([key]) => key);

      expect(untranslated).toEqual([]);
    },
  );
});
