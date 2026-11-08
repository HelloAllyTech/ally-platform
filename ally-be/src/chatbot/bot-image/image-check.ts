import { createHash } from 'crypto';
// sharp's package-level `types` are its ESM typings; this CommonJS build gets `module.exports =
// sharp` at run time, which its CJS typings describe. The type import is erased.
import type sharpCjs = require('sharp/dist/index.cjs');

const sharp: typeof sharpCjs = require('sharp');

/**
 * Checking and re-encoding an uploaded image (chunk 20d §4). Pure: bytes in, bytes out, no storage.
 *
 * - The type comes from the bytes (magic numbers), never the file name or the claimed type.
 * - PNG, JPEG and WebP are accepted. SVG only for logos, and it is **rasterised** to PNG: we never
 *   store or serve SVG, so there is no script, event handler or `foreignObject` to sanitise.
 *   Before rendering, an SVG with a DOCTYPE or entities (XML bombs) or a reference to anything
 *   outside itself is refused, so the renderer never reaches for a file or a URL.
 * - Everything is re-encoded, which drops EXIF, GPS and every other metadata block; the image is
 *   rotated upright from its EXIF orientation first.
 * - Variants: WebP at 256, 768 and 1600 px wide, never enlarged, plus the original size.
 */

export type ImageType = 'png' | 'jpeg' | 'webp' | 'svg';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** The longest side, in pixels. */
export const IMAGE_MAX_SIDE = 6000;
/** A decompression-bomb guard for sharp: no input over 6000 × 6000 pixels is even decoded. */
export const IMAGE_MAX_PIXELS = IMAGE_MAX_SIDE * IMAGE_MAX_SIDE;
export const VARIANT_WIDTHS = [256, 768, 1600] as const;
export type VariantSize = (typeof VARIANT_WIDTHS)[number] | 'original';
/** A rasterised SVG logo's width. */
export const SVG_RASTER_WIDTH = 1024;

/** Why an image was refused. Each maps to a line in copy §19. */
export type ImageProblem = 'too_large' | 'wrong_type' | 'too_many_pixels';

export class ImageCheckError extends Error {
  constructor(readonly problem: ImageProblem) {
    super(problem);
  }
}

/** The image's real type from its first bytes, or null. SVG is sniffed from its text. */
export function sniffImageType(bytes: Buffer): ImageType | null {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  const head = bytes
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^﻿/, '')
    .trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head))
    return 'svg';
  return null;
}

/**
 * Whether an SVG is safe to hand to the renderer: no DOCTYPE or entity declarations, and no
 * reference to anything outside the file (only `#fragment` links and `data:` images).
 */
export function svgIsSelfContained(text: string): boolean {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return false;
  if (/<\s*(foreignObject|script|iframe|object|embed)\b/i.test(text))
    return false;
  for (const match of text.matchAll(
    /(?:xlink:)?href\s*=\s*["']\s*([^"']*)["']/gi,
  )) {
    const target = match[1].trim();
    if (
      !target.startsWith('#') &&
      !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(target)
    ) {
      return false;
    }
  }
  if (/url\(\s*["']?\s*(?!#|data:)/i.test(text)) return false;
  if (/@import/i.test(text)) return false;
  return true;
}

export interface ProcessedImage {
  type: ImageType;
  width: number;
  height: number;
  /** sha256 of the re-encoded original, hex: the content-hashed name. */
  hash: string;
  original: { bytes: Buffer; ext: 'png' | 'jpg' | 'webp'; contentType: string };
  variants: { width: (typeof VARIANT_WIDTHS)[number]; bytes: Buffer }[];
}

/** Check, re-encode and resize. Throws `ImageCheckError` for anything refused. */
export async function processImage(
  bytes: Buffer,
  options: { allowSvg: boolean },
): Promise<ProcessedImage> {
  if (bytes.length > IMAGE_MAX_BYTES) throw new ImageCheckError('too_large');
  const type = sniffImageType(bytes);
  if (!type || (type === 'svg' && !options.allowSvg)) {
    throw new ImageCheckError('wrong_type');
  }

  let input: sharpCjs.Sharp;
  if (type === 'svg') {
    if (!svgIsSelfContained(bytes.toString('utf8'))) {
      throw new ImageCheckError('wrong_type');
    }
    input = sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      density: 300,
    }).resize({
      width: SVG_RASTER_WIDTH,
      withoutEnlargement: false,
    });
  } else {
    input = sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      failOn: 'error',
    });
  }

  let meta: sharpCjs.Metadata;
  try {
    meta = await sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      ...(type === 'svg' ? {} : { failOn: 'error' as const }),
    }).metadata();
  } catch (error) {
    if (/pixel limit/i.test((error as Error).message)) {
      throw new ImageCheckError('too_many_pixels');
    }
    throw new ImageCheckError('wrong_type');
  }
  if (
    type !== 'svg' &&
    Math.max(meta.width ?? 0, meta.height ?? 0) > IMAGE_MAX_SIDE
  ) {
    throw new ImageCheckError('too_many_pixels');
  }

  // Upright from EXIF, then re-encoded: sharp writes no metadata unless asked, so EXIF and GPS go.
  let original: ProcessedImage['original'];
  let decoded: { data: Buffer; info: sharpCjs.OutputInfo };
  try {
    const upright = input.rotate();
    if (type === 'jpeg') {
      decoded = await upright
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      original = { bytes: decoded.data, ext: 'jpg', contentType: 'image/jpeg' };
    } else if (type === 'webp') {
      decoded = await upright
        .webp({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      original = {
        bytes: decoded.data,
        ext: 'webp',
        contentType: 'image/webp',
      };
    } else {
      decoded = await upright
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      original = { bytes: decoded.data, ext: 'png', contentType: 'image/png' };
    }
  } catch (error) {
    if (/pixel limit/i.test((error as Error).message)) {
      throw new ImageCheckError('too_many_pixels');
    }
    throw new ImageCheckError('wrong_type');
  }

  const variants: ProcessedImage['variants'] = [];
  for (const width of VARIANT_WIDTHS) {
    const out = await sharp(original.bytes)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    variants.push({ width, bytes: out });
  }

  return {
    type,
    width: decoded.info.width,
    height: decoded.info.height,
    hash: createHash('sha256').update(original.bytes).digest('hex'),
    original,
    variants,
  };
}
