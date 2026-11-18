import type { BotImage } from '../entity/bot-image.entity';
import { VARIANT_WIDTHS } from './image-check';

/** The first 32 hex characters of the content hash name an image's files. */
export const fileStem = (image: Pick<BotImage, 'contentHash'>): string =>
  image.contentHash.slice(0, 32);

/** `<stem>-<size>.webp`: the only files the public route serves (originals stay private). */
export const PUBLIC_FILE = /^([0-9a-f]{32})-(256|768|1600)\.webp$/;

/** An image as the visitor's page gets it: a URL per size, alt text and its shape. */
export interface PublicImage {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
}

/** URLs on the public image route, which serves them only while the page is live and uses them. */
export function publicImage(
  apiBaseUrl: string,
  slug: string,
  image: Pick<
    BotImage,
    'contentHash' | 'contentType' | 'width' | 'height' | 'alt'
  >,
  preferred: (typeof VARIANT_WIDTHS)[number] = 768,
): PublicImage {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/public/bot-images/${encodeURIComponent(slug)}/${fileStem(image)}`;
  // Variants are never enlarged, so a small image's larger variants are its own size: list each
  // real width once.
  const seen = new Set<number>();
  const srcset = VARIANT_WIDTHS.flatMap((w) => {
    const real = Math.min(w, image.width);
    if (seen.has(real)) return [];
    seen.add(real);
    return [`${base}-${w}.webp ${real}w`];
  }).join(', ');
  return {
    src: `${base}-${preferred}.webp`,
    srcset,
    width: image.width,
    height: image.height,
    alt: image.alt,
  };
}
