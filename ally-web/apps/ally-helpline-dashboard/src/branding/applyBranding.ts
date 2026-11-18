import { LOCAL_STORAGE_KEYS } from "@constants";
import type { TenantBranding } from "@types";

/**
 * Paints an organization's branding onto the document, or takes it off.
 *
 * Everything the consumer app colours with Ally Blue already reads a token:
 * Tailwind's `primary-*` scale is `rgb(var(--color-primary-*))` (index.css)
 * and Carbon's interactive tokens are retinted in carbon-claude.css. So
 * branding is a matter of setting those variables on `<html>` as inline
 * style, which outranks every stylesheet selector (including the doubled
 * `:root:root` the retint uses to protect itself), and removing them to go
 * back to the defaults the stylesheets declare.
 *
 * The ramp itself comes from the backend; nothing here derives colours.
 */

export const DEFAULT_DOCUMENT_TITLE = "Ally";
export const DEFAULT_FAVICON = "/favicon.ico";

const RAMP_STEPS = ["DEFAULT", 50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Carbon tokens the retint pins to Ally Blue, and which ramp step each takes. */
const CDS_TOKENS: ReadonlyArray<[token: string, step: 500 | 600 | 700]> = [
  ["--cds-interactive", 500],
  ["--cds-focus", 500],
  ["--cds-border-interactive", 500],
  ["--cds-icon-interactive", 500],
  ["--cds-background-brand", 500],
  ["--cds-link-primary", 500],
  ["--cds-link-primary-hover", 600],
  ["--cds-link-secondary", 700],
  ["--cds-button-primary", 500],
  ["--cds-button-primary-hover", 600],
  ["--cds-button-primary-active", 700],
  ["--cds-button-tertiary", 500],
  ["--cds-button-tertiary-hover", 600],
  ["--cds-button-tertiary-active", 700],
];

const FOREGROUND_VAR = "--color-primary-foreground";
const CDS_TEXT_ON_COLOR = "--cds-text-on-color";

/** `#RRGGBB` → `"r g b"`, the form index.css declares the ramp in. */
export const hexToRgbTriplet = (hex: string): string => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
};

const faviconLink = (): HTMLLinkElement => {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;
  const link = document.createElement("link");
  link.setAttribute("rel", "icon");
  document.head.appendChild(link);
  return link;
};

export const isBrandingOn = (b: TenantBranding | null | undefined): b is TenantBranding =>
  !!b && b.enabled === true;

/** Apply an org's branding; anything not enabled means "back to Ally". */
export function applyBranding(branding: TenantBranding | null | undefined): void {
  const style = document.documentElement.style;
  if (!isBrandingOn(branding)) {
    RAMP_STEPS.forEach(step => style.removeProperty(`--color-primary-${step}`));
    style.removeProperty(FOREGROUND_VAR);
    CDS_TOKENS.forEach(([token]) => style.removeProperty(token));
    style.removeProperty(CDS_TEXT_ON_COLOR);
    document.title = DEFAULT_DOCUMENT_TITLE;
    faviconLink().setAttribute("href", DEFAULT_FAVICON);
    return;
  }
  const ramp = branding.tokens.primary;
  RAMP_STEPS.forEach(step =>
    style.setProperty(`--color-primary-${step}`, hexToRgbTriplet(ramp[step])),
  );
  style.setProperty(FOREGROUND_VAR, hexToRgbTriplet(branding.tokens.onPrimary));
  CDS_TOKENS.forEach(([token, step]) => style.setProperty(token, ramp[step]));
  style.setProperty(CDS_TEXT_ON_COLOR, branding.tokens.onPrimary);
  document.title = branding.displayName || DEFAULT_DOCUMENT_TITLE;
  faviconLink().setAttribute("href", branding.faviconUrl || DEFAULT_FAVICON);
}

/** Remember the branding for the next load, or forget it. Storage may be unavailable. */
export function cacheBranding(branding: TenantBranding | null | undefined): void {
  try {
    if (isBrandingOn(branding)) {
      localStorage.setItem(LOCAL_STORAGE_KEYS.ORG_BRANDING, JSON.stringify(branding));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ORG_BRANDING);
    }
  } catch {
    // Private mode or blocked storage: the live fetch still paints the page.
  }
}

export function readCachedBranding(): TenantBranding | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.ORG_BRANDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TenantBranding;
    return isBrandingOn(parsed) && parsed.tokens?.primary?.[500] ? parsed : null;
  } catch {
    return null;
  }
}

/** Called from main.tsx before React mounts, so a reload never flashes Ally Blue. */
export function applyCachedBranding(): void {
  const cached = readCachedBranding();
  if (cached) applyBranding(cached);
}
