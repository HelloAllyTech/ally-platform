/** Languages a landing page can offer: the ones the consumer app is translated into. */
export const LANDING_LANGUAGES = ['en', 'hi', 'mr', 'ta', 'kn'] as const;

export type LandingLanguage = (typeof LANDING_LANGUAGES)[number];

/** The three blocks on a landing page, each with a page of its own. */
export const LANDING_CARD_KEYS = ['practice', 'courses', 'resources'] as const;

export type LandingCardKey = (typeof LANDING_CARD_KEYS)[number];

/** The page designs an admin can switch between. Same content, different layout. */
export const LANDING_TEMPLATES = ['standard', 'split', 'focus'] as const;

export type LandingTemplate = (typeof LANDING_TEMPLATES)[number];

export const LANDING_LIMITS = {
  /** Headings, titles, names, roles. */
  SHORT_TEXT: 200,
  /** Intros, descriptions, quotes, helpline and disclaimer lines. */
  LONG_TEXT: 600,
  URL: 500,
  SLIDES: 10,
  ENTRIES_PER_CARD: 20,
  PARTNERS: 8,
  PAGE_NAME: 160,
  SLUG: 60,
} as const;

/** A slug is a lowercase address segment: letters, digits and single hyphens. */
export const LANDING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * First address segments the app already uses. A page lives at
 * `/<tenant-code>/<slug>`, so a tenant whose code is one of these would have
 * addresses that look like an existing app page. Refused when a page is
 * created. Keep in step with the consumer app's top-level routes
 * (`ally-web/apps/ally-helpline-dashboard/src/constants/routes.ts`).
 */
export const LANDING_RESERVED_TENANT_CODES: readonly string[] = [
  'login',
  'signup',
  'health',
  'auth',
  'suspended-user',
  'impersonate',
  'terms',
  'privacy',
  'blog',
  'learn',
  'scenario',
  'pathway',
  'case',
  'track',
  'course',
  'journey',
  'talk',
  'v2',
  'b',
  'admin',
  'api',
  'sjt1',
  'sjtreport1',
  'landingpage1',
  'assets',
  'static',
];

/** S3 key prefix for landing page images. */
export const LANDING_IMAGE_S3_PREFIX = 'landing-pages';

export const LANDING_IMAGE_MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

/** Public reads are cached briefly so a campaign spike doesn't reach the database. */
export const LANDING_PUBLIC_CACHE_SECONDS = 60;
