/**
 * Organization branding — the parts of the consumer web UI a partner org may
 * restyle to match its own identity (v1: logo, display name, one brand
 * colour, favicon + tab title, welcome line). Lives under
 * `tenants.settings.branding`; see DATA_SCHEMA.md § tenants.
 *
 * Two shapes, deliberately:
 *  - `TenantBrandingStored` is the PARTIAL an admin saved. Every field is
 *    optional so adding one later needs no backfill, and `enabled` is the
 *    org-level switch only an unrestricted platform admin may flip.
 *  - `TenantBrandingResolved` is what clients consume. It is always complete:
 *    stored values laid over Ally defaults, the colour ramp derived from the
 *    one brand hex, and — when the switch is off — the defaults regardless of
 *    what is stored, so a disabled org can never leak a half-configured brand.
 */

export interface TenantBrandingStored {
  /** Org-level switch. Off = clients get Ally defaults; stored values are kept. */
  enabled?: boolean;
  /** Shown in place of the org's registered name. Null = use `tenants.name`. */
  displayName?: string | null;
  /** One brand hex, `#RRGGBB`. Links, focus, selected states, primary CTA. */
  primaryColor?: string | null;
  /** Assets-bucket URL of a PNG/ICO/WebP favicon. Null = Ally favicon. */
  faviconUrl?: string | null;
  /** One line under the logo on the login and talker pages. */
  welcomeLine?: string | null;
}

/** Light-to-dark ramp derived from the brand hex, keyed like Tailwind. */
export interface BrandColourRamp {
  DEFAULT: string;
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface TenantBrandingTokens {
  primary: BrandColourRamp;
  /** Text colour that passes on the brand colour: bone or ink. */
  onPrimary: string;
}

export interface TenantBrandingResolved {
  enabled: boolean;
  displayName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  welcomeLine: string | null;
  /** Always true in v1: the mark is not a per-org choice. */
  poweredByAlly: true;
  tokens: TenantBrandingTokens;
}

export interface ContrastReport {
  /** Brand colour against the page background. */
  onBackground: number;
  /** `onPrimary` text against the brand colour. */
  textOnPrimary: number;
}
