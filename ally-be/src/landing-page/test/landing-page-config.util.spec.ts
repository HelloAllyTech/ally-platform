import { BadRequestException } from '@nestjs/common';

import { LANDING_LIMITS } from '../constants/landing-page.constants';
import {
  defaultLandingPageConfig,
  landingPagePublishProblems,
  normaliseLandingPageConfig,
} from '../util/landing-page-config.util';

const HOST = 'assets.s3.example.amazonaws.com';
const options = {
  isAllowedImageUrl: (url: string) =>
    url.startsWith(`https://${HOST}/landing-pages/`),
};
const ownImage = `https://${HOST}/landing-pages/t1/hero.png`;

const normalise = (raw: unknown) => normaliseLandingPageConfig(raw, options);

describe('normaliseLandingPageConfig', () => {
  it('turns nothing, or junk, into the default page', () => {
    const expected = defaultLandingPageConfig();
    expect(normalise(undefined)).toEqual(expected);
    expect(normalise(null)).toEqual(expected);
    expect(normalise('nope')).toEqual(expected);
    expect(normalise([1, 2, 3])).toEqual(expected);
  });

  it('starts a page on the standard template with the three blocks and no extras', () => {
    const config = defaultLandingPageConfig();
    expect(config.template).toBe('standard');
    expect(config.cards.items.map((card) => card.key)).toEqual([
      'practice',
      'courses',
      'resources',
    ]);
    expect(config.hero.enabled).toBe(false);
    expect(config.slider.enabled).toBe(false);
    expect(config.signUp.enabled).toBe(false);
  });

  describe('template', () => {
    it.each(['standard', 'split', 'focus'])('keeps %s', (template) => {
      expect(normalise({ template }).template).toBe(template);
    });

    it('falls back to standard for anything else', () => {
      expect(normalise({ template: 'neon' }).template).toBe('standard');
      expect(normalise({ template: 7 }).template).toBe('standard');
    });
  });

  describe('languages', () => {
    it('keeps only supported languages, once each', () => {
      const config = normalise({
        languages: { enabled: ['hi', 'xx', 'en', 'hi'], default: 'en' },
      });
      expect(config.languages.enabled).toEqual(['hi', 'en']);
    });

    it('falls back to English when none are valid', () => {
      expect(normalise({ languages: { enabled: ['xx'] } }).languages).toEqual({
        enabled: ['en'],
        default: 'en',
      });
    });

    it('never leaves the default outside the enabled languages', () => {
      const config = normalise({
        languages: { enabled: ['hi', 'ta'], default: 'en' },
      });
      expect(config.languages.default).toBe('hi');
    });
  });

  describe('text', () => {
    it('keeps plain text only: trims, strips control characters, clamps length', () => {
      const config = normalise({
        headings: {
          first: { en: '  Hello\u0000 world  ', xx: 'ignored' },
          second: { en: 'x'.repeat(LANDING_LIMITS.SHORT_TEXT + 50) },
        },
      });
      expect(config.headings.first).toEqual({ en: 'Hello world' });
      expect(config.headings.second.en).toHaveLength(LANDING_LIMITS.SHORT_TEXT);
    });

    it('does not turn markup into anything but text', () => {
      const config = normalise({
        headings: { first: { en: '<img src=x onerror=alert(1)>' } },
      });
      expect(config.headings.first.en).toBe('<img src=x onerror=alert(1)>');
    });

    it('drops empty text instead of storing blanks', () => {
      expect(
        normalise({ headings: { first: { en: '   ', hi: '' } } }).headings
          .first,
      ).toEqual({});
    });
  });

  describe('images', () => {
    it('accepts an address from our own storage', () => {
      const config = normalise({ hero: { enabled: true, imageUrl: ownImage } });
      expect(config.hero.imageUrl).toBe(ownImage);
    });

    it.each([
      'http://assets.s3.example.amazonaws.com/landing-pages/x.png',
      'https://evil.example.com/landing-pages/x.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `https://${HOST}/other-prefix/x.png`,
    ])('refuses %s', (url) => {
      expect(() => normalise({ hero: { imageUrl: url } })).toThrow(
        BadRequestException,
      );
    });

    it('treats empty as no image', () => {
      expect(normalise({ hero: { imageUrl: '' } }).hero.imageUrl).toBeNull();
      expect(normalise({ hero: { imageUrl: null } }).hero.imageUrl).toBeNull();
    });

    it('ignores a pasted logo address unless the logo is custom', () => {
      expect(
        normalise({ logo: { source: 'tenant', url: ownImage } }).logo.url,
      ).toBeNull();
      expect(
        normalise({ logo: { source: 'custom', url: ownImage } }).logo.url,
      ).toBe(ownImage);
    });

    it('refuses a custom logo that is not from our storage', () => {
      expect(() =>
        normalise({
          logo: { source: 'custom', url: 'https://evil.example.com/a.png' },
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('links', () => {
    const entryWith = (linkUrl: string) =>
      normalise({
        cards: {
          items: [
            { key: 'courses', entries: [{ title: { en: 'A' }, linkUrl }] },
          ],
        },
      });

    it('accepts http(s) addresses and app paths', () => {
      expect(
        entryWith('https://example.com/a').cards.items[1].entries[0].linkUrl,
      ).toBe('https://example.com/a');
      expect(entryWith('/learn').cards.items[1].entries[0].linkUrl).toBe(
        '/learn',
      );
    });

    it.each([
      'javascript:alert(1)',
      'data:text/html,hi',
      '//evil.example.com',
      'ftp://x.example.com',
      'plain text',
    ])('refuses %s', (url) => {
      expect(() => entryWith(url)).toThrow(BadRequestException);
    });
  });

  describe('cards', () => {
    it('always returns the three cards, in the fixed order', () => {
      const config = normalise({
        cards: {
          items: [
            { key: 'resources', title: { en: 'R' } },
            { key: 'practice', title: { en: 'P' } },
            { key: 'bogus', title: { en: 'B' } },
          ],
        },
      });
      expect(config.cards.items.map((card) => card.key)).toEqual([
        'practice',
        'courses',
        'resources',
      ]);
      expect(config.cards.items[0].title).toEqual({ en: 'P' });
      expect(config.cards.items[1].title).toEqual({});
      expect(config.cards.items[2].title).toEqual({ en: 'R' });
    });

    it('caps entries per card', () => {
      const entries = Array.from({ length: 50 }, (_, index) => ({
        title: { en: `E${index}` },
      }));
      const config = normalise({
        cards: { items: [{ key: 'courses', entries }] },
      });
      expect(config.cards.items[1].entries).toHaveLength(
        LANDING_LIMITS.ENTRIES_PER_CARD,
      );
    });
  });

  describe('slider and footer', () => {
    it('caps the number of slides', () => {
      const slides = Array.from({ length: 30 }, () => ({ quote: { en: 'q' } }));
      expect(
        normalise({ slider: { enabled: true, slides } }).slider.slides,
      ).toHaveLength(LANDING_LIMITS.SLIDES);
    });

    it('drops a partner with no logo and keeps one with a logo from our storage', () => {
      const config = normalise({
        footer: {
          partners: [
            { name: 'No logo' },
            {
              name: 'ElevenLabs',
              logoUrl: ownImage,
              linkUrl: 'https://elevenlabs.io',
            },
          ],
        },
      });
      expect(config.footer.partners).toEqual([
        {
          name: 'ElevenLabs',
          logoUrl: ownImage,
          linkUrl: 'https://elevenlabs.io',
        },
      ]);
    });

    it('caps partner logos', () => {
      const partners = Array.from({ length: 20 }, (_, index) => ({
        name: `P${index}`,
        logoUrl: ownImage,
      }));
      expect(normalise({ footer: { partners } }).footer.partners).toHaveLength(
        LANDING_LIMITS.PARTNERS,
      );
    });

    it('reads the Ally and tenant footer logo switches', () => {
      const config = normalise({
        footer: { showAllyLogo: false, showTenantLogo: true },
      });
      expect(config.footer.showAllyLogo).toBe(false);
      expect(config.footer.showTenantLogo).toBe(true);
    });
  });

  it('is stable: cleaning a cleaned config changes nothing', () => {
    const once = normalise({
      template: 'split',
      languages: { enabled: ['en', 'hi'], default: 'hi' },
      headings: { first: { en: 'A', hi: 'अ' } },
      hero: { enabled: true, imageUrl: ownImage },
    });
    expect(normalise(once)).toEqual(once);
  });
});

describe('landingPagePublishProblems', () => {
  const ready = () => {
    const config = defaultLandingPageConfig();
    config.headings.first = { en: 'Baat Se Baat Banegi' };
    config.helpline.text = { en: 'Call [number]' };
    config.footer.disclaimer.text = { en: 'Not an emergency service' };
    for (const card of config.cards.items) card.title = { en: card.key };
    return config;
  };

  it('lets a complete page publish', () => {
    expect(landingPagePublishProblems(ready())).toEqual([]);
  });

  it('needs the first heading in every language the page offers', () => {
    const config = ready();
    config.languages = { enabled: ['en', 'hi'], default: 'en' };
    expect(landingPagePublishProblems(config)).toContain(
      'The first heading is empty in hi.',
    );
  });

  it('needs the helpline line while the strip is on, and not when it is off', () => {
    const config = ready();
    config.helpline.text = {};
    expect(landingPagePublishProblems(config)).toContain(
      'The helpline line is on but empty in en.',
    );
    config.helpline.enabled = false;
    expect(landingPagePublishProblems(config)).toEqual([]);
  });

  it('needs the disclaimer while it is on', () => {
    const config = ready();
    config.footer.disclaimer.text = {};
    expect(landingPagePublishProblems(config)).toContain(
      'The footer disclaimer is on but empty in en.',
    );
  });

  it('needs a title on every card that is shown', () => {
    const config = ready();
    config.cards.items[0].title = {};
    expect(landingPagePublishProblems(config)).toContain(
      'The "practice" card has no title in en.',
    );
    config.cards.items[0].enabled = false;
    expect(landingPagePublishProblems(config)).toEqual([]);
  });

  it('refuses a custom logo, a hero or a slider with nothing in it', () => {
    const config = ready();
    config.logo.source = 'custom';
    config.hero.enabled = true;
    config.slider.enabled = true;
    const problems = landingPagePublishProblems(config);
    expect(problems).toContain(
      'The logo is set to a custom image but none is uploaded.',
    );
    expect(problems).toContain('The hero image is on but none is uploaded.');
    expect(problems).toContain('The quote slider is on but has no slides.');
  });

  it('needs every quote filled in every language while the slider is on', () => {
    const config = ready();
    config.slider.enabled = true;
    config.slider.slides = [{ quote: {}, name: {}, role: {}, photoUrl: null }];
    expect(landingPagePublishProblems(config)).toContain(
      'Quote 1 is empty in en.',
    );
  });
});
