import { ALLY_BONE, ALLY_INK } from '../constants/tenant-branding.constants';
import { BrandColourRamp } from '../type/tenant-branding.types';

/**
 * Pure colour maths for organization branding: one brand hex in, a ramp and
 * contrast numbers out. This is THE place these are computed — the consumer
 * app applies the ramp it is handed and never re-derives it, so two clients
 * can never disagree on what an org's 600 or 700 step is.
 */

export const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

type Rgb = [number, number, number];

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}

/** Uppercase `#RRGGBB`, the one spelling stored and compared. */
export function normaliseHex(hex: string): string {
  return hex.toUpperCase();
}

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
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** Linear blend of `a` toward `b` by `t` in [0, 1]. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/**
 * Tints toward white above the anchor, shades toward black below it. The
 * factors keep Tailwind's lightness rhythm so existing pairings in the app
 * (a 100 fill under 700 text, a 200 border on a 50 ground) hold their
 * contrast whatever hue the org picks. 500 is the brand colour itself.
 */
const TINT_STEPS: ReadonlyArray<[keyof BrandColourRamp, number]> = [
  [50, 0.92],
  [100, 0.84],
  [200, 0.68],
  [300, 0.5],
  [400, 0.28],
];
const SHADE_STEPS: ReadonlyArray<[keyof BrandColourRamp, number]> = [
  [600, 0.18],
  [700, 0.37],
  [800, 0.58],
  [900, 0.74],
];

export function buildColourRamp(hex: string): BrandColourRamp {
  const base = hexToRgb(hex);
  const ramp: Partial<BrandColourRamp> = {
    DEFAULT: normaliseHex(hex),
    500: normaliseHex(hex),
  };
  for (const [step, t] of TINT_STEPS)
    ramp[step] = rgbToHex(mix(base, WHITE, t));
  for (const [step, t] of SHADE_STEPS)
    ramp[step] = rgbToHex(mix(base, BLACK, t));
  return ramp as BrandColourRamp;
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

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). Rounded to 2 dp. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * The label colour for a surface painted in the brand colour: whichever of
 * bone or ink reads better on it. Bone wins ties, since the primary button
 * reads as "light text on colour" everywhere else in the app.
 */
export function pickOnPrimary(hex: string): string {
  return contrastRatio(hex, ALLY_INK) > contrastRatio(hex, ALLY_BONE)
    ? ALLY_INK
    : ALLY_BONE;
}

/**
 * `hex` darkened toward black, in small steps, until white text on it reads at `min` (WCAG AA for
 * body text is 4.5). Used for a bot page's accent (chunk 20d): the owner's colour is kept as chosen
 * and this corrected copy is what buttons and bubbles use.
 */
export function darkenForWhiteText(hex: string, min = 4.5): string {
  const base = hexToRgb(hex);
  for (let t = 0; t <= 1; t += 0.02) {
    const candidate = rgbToHex(mix(base, BLACK, t));
    if (contrastRatio(candidate, '#FFFFFF') >= min) return candidate;
  }
  return '#000000';
}
