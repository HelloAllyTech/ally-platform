import { BadRequestException } from '@nestjs/common';

import {
  LANDING_CARD_KEYS,
  LANDING_LANGUAGES,
  LANDING_LIMITS,
  LANDING_TEMPLATES,
  LandingCardKey,
  LandingLanguage,
  LandingTemplate,
} from '../constants/landing-page.constants';
import {
  LandingCard,
  LandingCardEntry,
  LandingPageConfig,
  LandingPartnerLogo,
  LandingQuoteSlide,
  LocalizedText,
} from '../type/landing-page-config.type';

type Obj = Record<string, unknown>;

export interface NormaliseOptions {
  /** True for an image address we served (our own storage). Anything else is refused. */
  isAllowedImageUrl: (url: string) => boolean;
}

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObj = (value: unknown): Obj => (isObj(value) ? value : {});

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

// Control characters other than tab/newline have no place in page copy.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Plain text only: trimmed, control characters removed, clamped. Never HTML. */
const cleanText = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value.replace(CONTROL_CHARS, '').trim().slice(0, max)
    : '';

const cleanBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const cleanLocalized = (value: unknown, max: number): LocalizedText => {
  const source = asObj(value);
  const out: LocalizedText = {};
  for (const language of LANDING_LANGUAGES) {
    const text = cleanText(source[language], max);
    if (text) out[language] = text;
  }
  return out;
};

const fail = (field: string, reason: string): never => {
  throw new BadRequestException(`${field}: ${reason}`);
};

const cleanImageUrl = (
  value: unknown,
  field: string,
  options: NormaliseOptions,
): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const url = cleanText(value, LANDING_LIMITS.URL);
  if (!url.startsWith('https://') || !options.isAllowedImageUrl(url)) {
    return fail(
      field,
      'upload the image through the editor instead of pasting an address',
    );
  }
  return url;
};

/** http(s) address or an app path ("/learn"); never javascript:, data: or protocol-relative. */
const cleanLinkUrl = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const url = cleanText(value, LANDING_LIMITS.URL);
  const isPath = url.startsWith('/') && !url.startsWith('//');
  const isWeb = /^https?:\/\/[^\s]+$/i.test(url);
  if (!isPath && !isWeb) {
    return fail(field, 'must be an http(s) address or a path starting with /');
  }
  return url;
};

const cleanTemplate = (value: unknown): LandingTemplate =>
  LANDING_TEMPLATES.find((template) => template === value) ?? 'standard';

const cleanLanguage = (value: unknown): LandingLanguage | null =>
  LANDING_LANGUAGES.find((language) => language === value) ?? null;

const cleanSlide = (
  raw: unknown,
  index: number,
  options: NormaliseOptions,
): LandingQuoteSlide => {
  const slide = asObj(raw);
  return {
    quote: cleanLocalized(slide.quote, LANDING_LIMITS.LONG_TEXT),
    name: cleanLocalized(slide.name, LANDING_LIMITS.SHORT_TEXT),
    role: cleanLocalized(slide.role, LANDING_LIMITS.SHORT_TEXT),
    photoUrl: cleanImageUrl(
      slide.photoUrl,
      `slider.slides[${index}].photoUrl`,
      options,
    ),
  };
};

const cleanEntry = (raw: unknown, field: string): LandingCardEntry => {
  const entry = asObj(raw);
  return {
    title: cleanLocalized(entry.title, LANDING_LIMITS.SHORT_TEXT),
    description: cleanLocalized(entry.description, LANDING_LIMITS.LONG_TEXT),
    linkUrl: cleanLinkUrl(entry.linkUrl, `${field}.linkUrl`),
  };
};

const cleanCard = (key: LandingCardKey, raw: unknown): LandingCard => {
  const card = asObj(raw);
  return {
    key,
    enabled: cleanBool(card.enabled, true),
    title: cleanLocalized(card.title, LANDING_LIMITS.SHORT_TEXT),
    intro: cleanLocalized(card.intro, LANDING_LIMITS.LONG_TEXT),
    entries: asArray(card.entries)
      .slice(0, LANDING_LIMITS.ENTRIES_PER_CARD)
      .map((entry, index) =>
        cleanEntry(entry, `cards.${key}.entries[${index}]`),
      ),
  };
};

const cleanPartner = (
  raw: unknown,
  index: number,
  options: NormaliseOptions,
): LandingPartnerLogo | null => {
  const partner = asObj(raw);
  const logoUrl = cleanImageUrl(
    partner.logoUrl,
    `footer.partners[${index}].logoUrl`,
    options,
  );
  if (!logoUrl) return null;
  return {
    name: cleanText(partner.name, LANDING_LIMITS.SHORT_TEXT),
    logoUrl,
    linkUrl: cleanLinkUrl(partner.linkUrl, `footer.partners[${index}].linkUrl`),
  };
};

/** A new page starts with the three blocks present and every optional block off. */
export const defaultLandingPageConfig = (): LandingPageConfig => ({
  version: 1,
  template: 'standard',
  languages: { enabled: ['en'], default: 'en' },
  signUp: { enabled: false },
  logo: { source: 'tenant', url: null, alt: {} },
  headings: { first: {}, second: {}, third: {} },
  hero: { enabled: false, imageUrl: null, imageAlt: {} },
  helpline: { enabled: true, text: {} },
  slider: { enabled: false, slides: [] },
  cards: {
    enabled: true,
    items: LANDING_CARD_KEYS.map((key) => ({
      key,
      enabled: true,
      title: {},
      intro: {},
      entries: [],
    })),
  },
  footer: {
    disclaimer: { enabled: true, text: {} },
    showAllyLogo: true,
    showTenantLogo: false,
    partners: [],
  },
});

/**
 * Turns whatever the editor sent into a config every reader can trust: unknown
 * keys dropped, text plain and clamped, the three cards always present in a
 * fixed order, the default language always one of the enabled ones. Throws a
 * 400 only for an address that is not allowed, so a bad link or image is
 * refused loudly rather than quietly dropped.
 */
export const normaliseLandingPageConfig = (
  raw: unknown,
  options: NormaliseOptions,
): LandingPageConfig => {
  const input = asObj(raw);
  const defaults = defaultLandingPageConfig();

  const languages = asObj(input.languages);
  const enabled = Array.from(
    new Set(
      asArray(languages.enabled)
        .map(cleanLanguage)
        .filter((language): language is LandingLanguage => language !== null),
    ),
  );
  const enabledLanguages = enabled.length
    ? enabled
    : defaults.languages.enabled;
  const requestedDefault = cleanLanguage(languages.default);
  const defaultLanguage =
    requestedDefault && enabledLanguages.includes(requestedDefault)
      ? requestedDefault
      : enabledLanguages[0];

  const logo = asObj(input.logo);
  const logoSource = logo.source === 'custom' ? 'custom' : 'tenant';
  const logoUrl =
    logoSource === 'custom'
      ? cleanImageUrl(logo.url, 'logo.url', options)
      : null;

  const headings = asObj(input.headings);
  const hero = asObj(input.hero);
  const helpline = asObj(input.helpline);
  const slider = asObj(input.slider);
  const cards = asObj(input.cards);
  const footer = asObj(input.footer);
  const disclaimer = asObj(footer.disclaimer);

  const cardInputs = asArray(cards.items).map(asObj);

  return {
    version: 1,
    template: cleanTemplate(input.template),
    languages: { enabled: enabledLanguages, default: defaultLanguage },
    signUp: {
      enabled: cleanBool(asObj(input.signUp).enabled, defaults.signUp.enabled),
    },
    logo: {
      source: logoSource,
      // A custom logo with no image yet is allowed while editing; publishing refuses it.
      url: logoUrl,
      alt: cleanLocalized(logo.alt, LANDING_LIMITS.SHORT_TEXT),
    },
    headings: {
      first: cleanLocalized(headings.first, LANDING_LIMITS.SHORT_TEXT),
      second: cleanLocalized(headings.second, LANDING_LIMITS.SHORT_TEXT),
      third: cleanLocalized(headings.third, LANDING_LIMITS.LONG_TEXT),
    },
    hero: {
      enabled: cleanBool(hero.enabled, defaults.hero.enabled),
      imageUrl: cleanImageUrl(hero.imageUrl, 'hero.imageUrl', options),
      imageAlt: cleanLocalized(hero.imageAlt, LANDING_LIMITS.SHORT_TEXT),
    },
    helpline: {
      enabled: cleanBool(helpline.enabled, defaults.helpline.enabled),
      text: cleanLocalized(helpline.text, LANDING_LIMITS.LONG_TEXT),
    },
    slider: {
      enabled: cleanBool(slider.enabled, defaults.slider.enabled),
      slides: asArray(slider.slides)
        .slice(0, LANDING_LIMITS.SLIDES)
        .map((slide, index) => cleanSlide(slide, index, options)),
    },
    cards: {
      enabled: cleanBool(cards.enabled, defaults.cards.enabled),
      // Always the three known cards, in the fixed order, however many were sent.
      items: LANDING_CARD_KEYS.map((key) =>
        cleanCard(
          key,
          cardInputs.find((card) => card.key === key),
        ),
      ),
    },
    footer: {
      disclaimer: {
        enabled: cleanBool(
          disclaimer.enabled,
          defaults.footer.disclaimer.enabled,
        ),
        text: cleanLocalized(disclaimer.text, LANDING_LIMITS.LONG_TEXT),
      },
      showAllyLogo: cleanBool(
        footer.showAllyLogo,
        defaults.footer.showAllyLogo,
      ),
      showTenantLogo: cleanBool(
        footer.showTenantLogo,
        defaults.footer.showTenantLogo,
      ),
      partners: asArray(footer.partners)
        .slice(0, LANDING_LIMITS.PARTNERS)
        .map((partner, index) => cleanPartner(partner, index, options))
        .filter((partner): partner is LandingPartnerLogo => partner !== null),
    },
  };
};

/**
 * What a page must have before it can go live. Returns plain-language
 * problems; an empty list means it can publish. A parent-facing page about
 * suicide must not go public with a blank headline, a missing helpline line
 * while the strip is on, or a language switch that opens onto empty text.
 */
export const landingPagePublishProblems = (
  config: LandingPageConfig,
): string[] => {
  const problems: string[] = [];
  const hasText = (text: LocalizedText, language: LandingLanguage): boolean =>
    Boolean(text[language]?.trim());

  for (const language of config.languages.enabled) {
    if (!hasText(config.headings.first, language)) {
      problems.push(`The first heading is empty in ${language}.`);
    }
    if (config.helpline.enabled && !hasText(config.helpline.text, language)) {
      problems.push(`The helpline line is on but empty in ${language}.`);
    }
    if (
      config.footer.disclaimer.enabled &&
      !hasText(config.footer.disclaimer.text, language)
    ) {
      problems.push(`The footer disclaimer is on but empty in ${language}.`);
    }
    if (config.cards.enabled) {
      for (const card of config.cards.items.filter((item) => item.enabled)) {
        if (!hasText(card.title, language)) {
          problems.push(`The "${card.key}" card has no title in ${language}.`);
        }
      }
    }
  }

  if (config.logo.source === 'custom' && !config.logo.url) {
    problems.push('The logo is set to a custom image but none is uploaded.');
  }
  if (config.hero.enabled && !config.hero.imageUrl) {
    problems.push('The hero image is on but none is uploaded.');
  }
  if (config.slider.enabled && config.slider.slides.length === 0) {
    problems.push('The quote slider is on but has no slides.');
  }
  config.slider.slides.forEach((slide, index) => {
    for (const language of config.languages.enabled) {
      if (config.slider.enabled && !hasText(slide.quote, language)) {
        problems.push(`Quote ${index + 1} is empty in ${language}.`);
      }
    }
  });

  return problems;
};
