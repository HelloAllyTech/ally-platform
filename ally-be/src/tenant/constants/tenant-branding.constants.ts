import { TenantBrandingStored } from '../type/tenant-branding.types';

/**
 * Ally's own identity, byte-identical to the consumer app's `--color-primary-*`
 * anchor and surfaces in ally-web/apps/ally-helpline-dashboard/src/index.css.
 * An org with branding off (or never configured) resolves to exactly these,
 * so turning the feature on platform-wide changes nothing for anyone.
 */
export const ALLY_BRAND_PRIMARY = '#264D8E';
/** Page background the brand colour must stand out from (`--color-background`). */
export const ALLY_PAGE_BACKGROUND = '#F5F4EE';
/** Lightest surface; the label colour on an accent button. */
export const ALLY_BONE = '#FAF9F5';
/** Warm near-black; body copy and the alternative on-accent label. */
export const ALLY_INK = '#29261F';

export const TENANT_BRANDING_DEFAULTS: Required<TenantBrandingStored> = {
  enabled: false,
  displayName: null,
  primaryColor: ALLY_BRAND_PRIMARY,
  faviconUrl: null,
  welcomeLine: null,
};

export const TENANT_BRANDING_LIMITS = {
  DISPLAY_NAME_MAX: 60,
  WELCOME_LINE_MAX: 160,
  /** 512 KB — a favicon is tiny; the logo route already caps at 2 MB. */
  FAVICON_MAX_BYTES: 512 * 1024,
} as const;

/**
 * WCAG 2.x contrast thresholds. The brand colour drives links, focus rings
 * and the primary button, so it is judged as UI/large text (3:1 minimum)
 * against the page, and the admin is warned when it would also fail as body
 * text (4.5:1). Below the floor the save is refused — an unreadable accent is
 * worse for the partner than no accent.
 */
export const BRAND_CONTRAST = {
  REJECT_BELOW: 3,
  WARN_BELOW: 4.5,
} as const;

/**
 * No SVG: an uploaded SVG is a script host, and favicons render in the
 * browser chrome where nothing sanitises them. ICO carries both MIME forms
 * browsers emit.
 */
export enum FaviconUploadContentType {
  PNG = 'image/png',
  ICO = 'image/x-icon',
  ICO_MS = 'image/vnd.microsoft.icon',
  WEBP = 'image/webp',
  JPEG = 'image/jpeg',
}

/** Where tenant assets live; a branding URL anywhere else is refused. */
export const ASSETS_URL_PATTERN =
  /^https:\/\/[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com\/[^\s?#]+$/i;
