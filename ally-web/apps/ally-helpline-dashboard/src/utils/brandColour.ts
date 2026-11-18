/**
 * Colour maths for the org admin's Branding page: live preview and contrast
 * readout as they type.
 *
 * The backend (ally-be `src/tenant/util/brand-colour.util.ts`) is the source of
 * truth for the ramp and the contrast rule: what is SAVED comes back from it.
 * The admin console keeps an identical copy
 * (ally-admin-dashboard `src/utils/brandColour.ts`). Keep all three in step.
 */

export const ALLY_BRAND_PRIMARY = "#264D8E";
export const ALLY_PAGE_BACKGROUND = "#F5F4EE";
export const ALLY_BONE = "#FAF9F5";
export const ALLY_INK = "#29261F";

/** Mirrors ally-be BRAND_CONTRAST: refuse under 3:1, warn under 4.5:1. */
export const BRAND_CONTRAST = { REJECT_BELOW: 3, WARN_BELOW: 4.5 } as const;

export const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

type Rgb = [number, number, number];

export const isHexColour = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOUR.test(value);

export const normaliseHex = (hex: string): string => hex.toUpperCase();

export function hexToRgb(hex: string): Rgb {
  const m = HEX_COLOUR.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

export type PreviewRamp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

/** Same tint/shade factors as the backend ramp; 500 is the brand colour itself. */
export function buildPreviewRamp(hex: string): PreviewRamp {
  const base = hexToRgb(hex);
  return {
    50: rgbToHex(mix(base, WHITE, 0.92)),
    100: rgbToHex(mix(base, WHITE, 0.84)),
    200: rgbToHex(mix(base, WHITE, 0.68)),
    300: rgbToHex(mix(base, WHITE, 0.5)),
    400: rgbToHex(mix(base, WHITE, 0.28)),
    500: normaliseHex(hex),
    600: rgbToHex(mix(base, BLACK, 0.18)),
    700: rgbToHex(mix(base, BLACK, 0.37)),
    800: rgbToHex(mix(base, BLACK, 0.58)),
    900: rgbToHex(mix(base, BLACK, 0.74)),
  };
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21, rounded to 2 dp. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Bone or ink, whichever reads better on the brand colour; bone wins ties. */
export function pickOnPrimary(hex: string): string {
  return contrastRatio(hex, ALLY_INK) > contrastRatio(hex, ALLY_BONE) ? ALLY_INK : ALLY_BONE;
}

export type ContrastVerdict = "fail" | "weak" | "pass";

/**
 * One readout for the colour field. `fail` blocks Save (the backend would refuse
 * it anyway); `weak` saves with a warning; `pass` is silent.
 */
export function brandContrastVerdict(hex: string): { ratio: number; verdict: ContrastVerdict } {
  const ratio = contrastRatio(hex, ALLY_PAGE_BACKGROUND);
  if (ratio < BRAND_CONTRAST.REJECT_BELOW) return { ratio, verdict: "fail" };
  if (ratio < BRAND_CONTRAST.WARN_BELOW) return { ratio, verdict: "weak" };
  return { ratio, verdict: "pass" };
}
