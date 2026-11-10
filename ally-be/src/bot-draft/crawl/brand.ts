import {
  buildColourRamp,
  contrastRatio,
  isHexColour,
  normaliseHex,
} from '../../tenant/util/brand-colour.util';
import type { CrawlBrand } from '../type/bot-draft.type';
import type { ParsedPage } from './page-parser';

/** The bot page's background: an accent colour must read on it (3:1, as the tenant brand rule). */
const PAGE_BACKGROUND = '#F5F4EE';
const MIN_CONTRAST = 3;

/**
 * The site's logo, accent colour and favicon, from the start page (and its stylesheets' colours).
 * Logo: a header or "logo" image, then the apple-touch-icon, then og:image only when its declared
 * size is no wider than 2:1 (a social card is a banner, not a logo; chunk 20d). Colour: theme-color,
 * then the most common saturated colour in its CSS. A colour that doesn't read on the page is
 * darkened from its own ramp, or dropped.
 */
export function detectBrand(
  page: ParsedPage,
  pageUrl: string,
  css: string[],
): CrawlBrand {
  const resolve = (href: string | null) => {
    if (!href) return null;
    try {
      const url = new URL(href, pageUrl);
      return url.protocol === 'https:' || url.protocol === 'http:'
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  };
  const theme = toHex(page.meta.themeColor);
  const colour = readable(
    theme ?? commonColour([page.inlineCss, ...css].join('\n')),
  );
  return {
    logoUrl:
      resolve(page.logo) ??
      resolve(page.icons.appleTouch) ??
      (logoShaped(page.meta.ogImageWidth, page.meta.ogImageHeight)
        ? resolve(page.meta.ogImage)
        : null),
    accentColour: colour,
    faviconUrl: resolve(page.icons.icon) ?? resolve('/favicon.ico'),
  };
}

/** A declared size no wider (or taller) than 2:1; an undeclared size isn't trusted. */
function logoShaped(width: number | null, height: number | null): boolean {
  if (!width || !height) return false;
  return Math.max(width, height) / Math.min(width, height) <= 2;
}

export function toHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return normaliseHex(v);
  if (/^#[0-9a-f]{3}$/.test(v))
    return normaliseHex(`#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`);
  const rgb = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
  if (rgb) {
    return normaliseHex(
      `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`,
    );
  }
  return null;
}

/** The most used colour that is neither grey nor near white or black. */
export function commonColour(css: string): string | null {
  const counts = new Map<string, number>();
  for (const match of css.matchAll(
    /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)/g,
  )) {
    const hex = toHex(match[0]);
    if (!hex || !saturated(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const [hex, count] of counts) {
    if (count > most) {
      best = hex;
      most = count;
    }
  }
  return best;
}

function saturated(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 40 && max > 40 && min < 235;
}

/** The colour if it reads on the page, else its darker shade that does, else nothing. */
export function readable(hex: string | null): string | null {
  if (!hex || !isHexColour(hex)) return null;
  if (contrastRatio(hex, PAGE_BACKGROUND) >= MIN_CONTRAST)
    return normaliseHex(hex);
  const ramp = buildColourRamp(hex) as unknown as Record<number, string>;
  for (const step of [600, 700, 800]) {
    const shade = ramp[step];
    if (shade && contrastRatio(shade, PAGE_BACKGROUND) >= MIN_CONTRAST)
      return normaliseHex(shade);
  }
  return null;
}
