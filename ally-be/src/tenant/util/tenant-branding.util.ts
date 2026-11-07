import {
  ALLY_BRAND_PRIMARY,
  ALLY_PAGE_BACKGROUND,
  ASSETS_URL_PATTERN,
  BRAND_CONTRAST,
  TENANT_BRANDING_DEFAULTS,
  TENANT_BRANDING_LIMITS,
} from '../constants/tenant-branding.constants';
import {
  ContrastReport,
  TenantBrandingResolved,
  TenantBrandingStored,
} from '../type/tenant-branding.types';
import {
  buildColourRamp,
  contrastRatio,
  isHexColour,
  normaliseHex,
  pickOnPrimary,
} from './brand-colour.util';

/**
 * Validation, merge and resolution for `tenants.settings.branding`.
 *
 * Mirrors the helpline-settings contract: what is stored is a PARTIAL, laid
 * over the defaults on every read, and unknown keys in a patch are dropped
 * rather than rejected (they cannot widen access, and the admin form is built
 * against this contract). `enabled` is NOT patchable here — it is the org-level
 * switch, written only through the super-admin org edit (see
 * TenantService.updateTenant), so an assigned admin cannot switch their own
 * org on.
 */

export interface BrandingPatch {
  /** Lives on the tenant row, not in settings.branding; the service splits it off. */
  logoUrl?: string | null;
  displayName?: string | null;
  primaryColor?: string | null;
  faviconUrl?: string | null;
  welcomeLine?: string | null;
}

export interface BrandingValidationResult {
  value: BrandingPatch;
  errors: string[];
  /** Saved anyway, but the admin should know. */
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed text or null; empty string means "clear it". */
function text(
  key: string,
  raw: unknown,
  max: number,
  errors: string[],
): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    errors.push(`${key} must be text`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    errors.push(`${key} must be ${max} characters or fewer`);
    return undefined;
  }
  return trimmed;
}

export function validateBrandingPatch(
  patch: unknown,
): BrandingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const value: BrandingPatch = {};
  if (patch == null) return { value, errors, warnings };
  if (!isObject(patch)) {
    return { value, errors: ['branding must be an object'], warnings };
  }

  if ('displayName' in patch) {
    const v = text(
      'displayName',
      patch.displayName,
      TENANT_BRANDING_LIMITS.DISPLAY_NAME_MAX,
      errors,
    );
    if (v !== undefined) value.displayName = v;
  }

  if ('welcomeLine' in patch) {
    const v = text(
      'welcomeLine',
      patch.welcomeLine,
      TENANT_BRANDING_LIMITS.WELCOME_LINE_MAX,
      errors,
    );
    if (v !== undefined) value.welcomeLine = v;
  }

  if ('logoUrl' in patch) {
    const raw = patch.logoUrl;
    if (raw === null || raw === '') {
      value.logoUrl = null;
    } else if (typeof raw !== 'string' || !ASSETS_URL_PATTERN.test(raw)) {
      errors.push(
        'logoUrl must be a file uploaded through the logo upload route',
      );
    } else {
      value.logoUrl = raw;
    }
  }

  if ('faviconUrl' in patch) {
    const raw = patch.faviconUrl;
    if (raw === null || raw === '') {
      value.faviconUrl = null;
    } else if (typeof raw !== 'string' || !ASSETS_URL_PATTERN.test(raw)) {
      errors.push(
        'faviconUrl must be a file uploaded through the favicon upload route',
      );
    } else {
      value.faviconUrl = raw;
    }
  }

  if ('primaryColor' in patch) {
    const raw = patch.primaryColor;
    if (raw === null || raw === '') {
      value.primaryColor = null;
    } else if (!isHexColour(raw)) {
      errors.push('primaryColor must be a hex colour like #264D8E');
    } else {
      const hex = normaliseHex(raw);
      const { onBackground, textOnPrimary } = contrastReport(hex);
      if (onBackground < BRAND_CONTRAST.REJECT_BELOW) {
        errors.push(
          `primaryColor is too close to the page background to read ` +
            `(${onBackground}:1; needs at least ${BRAND_CONTRAST.REJECT_BELOW}:1). ` +
            `Pick a darker or more saturated shade.`,
        );
      } else {
        if (onBackground < BRAND_CONTRAST.WARN_BELOW) {
          warnings.push(
            `primaryColor passes for buttons and links (${onBackground}:1) ` +
              `but would be hard to read as text. A darker shade is safer.`,
          );
        }
        if (textOnPrimary < BRAND_CONTRAST.WARN_BELOW) {
          warnings.push(
            `Labels on primaryColor reach ${textOnPrimary}:1; some people ` +
              `will find button text hard to read.`,
          );
        }
        value.primaryColor = hex;
      }
    }
  }

  return { value, errors, warnings };
}

export function contrastReport(hex: string): ContrastReport {
  return {
    onBackground: contrastRatio(hex, ALLY_PAGE_BACKGROUND),
    textOnPrimary: contrastRatio(hex, pickOnPrimary(hex)),
  };
}

/** A validated patch over the stored partial — the shape that gets persisted. */
export function applyBrandingPatch(
  stored: TenantBrandingStored | null | undefined,
  patch: BrandingPatch,
): TenantBrandingStored {
  return { ...(stored ?? {}), ...patch };
}

/**
 * What a client should render for this org. Disabled (or never configured)
 * resolves to Ally's identity with the org's name and existing logo — the
 * two things every client already shows today — so the switch going off is
 * exactly a return to the current product, not a blank brand.
 */
export function resolveBranding(
  tenant: { name: string; logoUrl?: string | null },
  stored: TenantBrandingStored | null | undefined,
): TenantBrandingResolved {
  const enabled = stored?.enabled === true;
  const merged: Required<TenantBrandingStored> = {
    ...TENANT_BRANDING_DEFAULTS,
    ...(enabled ? pickKnown(stored) : {}),
    enabled,
  };
  const primaryColor: string = merged.primaryColor ?? ALLY_BRAND_PRIMARY;
  return {
    enabled,
    displayName: merged.displayName ?? tenant.name,
    logoUrl: tenant.logoUrl ?? null,
    faviconUrl: merged.faviconUrl,
    primaryColor,
    welcomeLine: merged.welcomeLine,
    poweredByAlly: true,
    tokens: {
      primary: buildColourRamp(primaryColor),
      onPrimary: pickOnPrimary(primaryColor),
    },
  };
}

/** Only keys the contract knows, and only non-null ones override a default. */
function pickKnown(
  stored: TenantBrandingStored | null | undefined,
): Partial<TenantBrandingStored> {
  if (!stored) return {};
  const out: Partial<TenantBrandingStored> = {};
  for (const key of Object.keys(TENANT_BRANDING_DEFAULTS) as Array<
    keyof TenantBrandingStored
  >) {
    const v = stored[key];
    if (v !== undefined && v !== null)
      (out as Record<string, unknown>)[key] = v;
  }
  return out;
}
