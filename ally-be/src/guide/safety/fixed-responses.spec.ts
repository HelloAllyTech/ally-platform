import {
  PLATFORM_DEFAULT_CRISIS_LINES,
  resolveSupportLines,
} from './fixed-responses';

describe('resolveSupportLines', () => {
  it('gives the platform default in the learner’s language, same numbers', () => {
    const hi = resolveSupportLines(null, 'hi');
    expect(hi.map((l) => l.phone)).toEqual(
      PLATFORM_DEFAULT_CRISIS_LINES.map((l) => l.phone),
    );
    expect(hi[0].name).toContain('Tele-MANAS');
    expect(hi[0].hours).toBe('24 घंटे, हर दिन');
    expect(hi[2].name).toBe('आपातकालीन सेवाएँ');
    expect(resolveSupportLines(null, 'ta-IN')[2].name).toBe('அவசர சேவைகள்');
  });

  it('falls back to English for a language it has no default for', () => {
    expect(resolveSupportLines(null, 'ml')).toEqual(
      PLATFORM_DEFAULT_CRISIS_LINES,
    );
  });

  it('the organisation’s own lines still win', () => {
    const own = [{ name: 'Our line', phone: '1', hours: null, url: null }];
    expect(
      resolveSupportLines({ supportLines: { en: own } } as any, 'hi'),
    ).toEqual(own);
  });
});
