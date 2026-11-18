// By path from brandColour, not `@utils`: the bot page imports this too and must stay small.
import { contrastRatio, hexToRgb, isHexColour, normaliseHex, rgbToHex } from "./brandColour";

type Rgb = [number, number, number];

const toHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr
      ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4;
  return [h * 60, s, l];
};

const fromHsl = (h: number, s: number, l: number): Rgb => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};

/** Ally's ink: the quiet pick that goes with any colour. */
export const INK = "#17171C";
/** When there is no logo colour to start from. */
const DEFAULT_SWATCHES = ["#3B3BD9", "#0F766E", "#7C3AED", "#C4512D", INK];

/**
 * The colour swatches on "Make it yours" (chunk 20d): the logo's colour first, then three hues
 * spread around the wheel from it at a calm saturation and depth, then ink. Five in all.
 */
export function colourSwatches(base: string | null | undefined): string[] {
  if (!isHexColour(base)) return DEFAULT_SWATCHES;
  const [h] = toHsl(hexToRgb(base));
  const picks = [150, 210, 270].map(turn => rgbToHex(fromHsl((h + turn) % 360, 0.62, 0.42)));
  return [...new Set([normaliseHex(base), ...picks.map(normaliseHex), INK])];
}

/**
 * `hex` darkened until white text on it reads at 4.5:1, as ally-be stores it (the preview shows
 * what visitors will get before the save comes back).
 */
export function readableAccent(hex: string, min = 4.5): string {
  const base = hexToRgb(hex);
  for (let t = 0; t <= 1; t += 0.02) {
    const candidate = rgbToHex([base[0] * (1 - t), base[1] * (1 - t), base[2] * (1 - t)]);
    if (contrastRatio(candidate, "#FFFFFF") >= min) return normaliseHex(candidate);
  }
  return "#000000";
}
