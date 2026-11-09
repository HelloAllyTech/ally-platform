import { Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import { ImageSlotProfile } from '../constants/image-slots.constants';

export interface ProcessedImage {
  /** Lossless PNG of what the provider returned; used later as a reference. */
  original: Buffer;
  /** WebP cropped to the slot's exact size; the URL the author's form stores. */
  display: Buffer;
  width: number;
  height: number;
}

/** Longest side of a reference sent back to a provider: enough for a face, cheap in input cost. */
const REFERENCE_MAX_SIDE = 1024;
const DISPLAY_WEBP_QUALITY = 82;

/**
 * A provider's PNG at 1536×1024 is 2–3 MB and 3:2; the editor's slots want a
 * strict 16:9 (or square) and learners load it on phones. The display copy is
 * cropped with sharp's attention strategy, which keeps the most salient
 * region (a face, the subject) inside the crop.
 */
@Injectable()
export class ImagePostprocessService {
  async process(
    input: Buffer,
    slot: ImageSlotProfile,
  ): Promise<ProcessedImage> {
    const original = await sharp(input).png().toBuffer();
    const display = await sharp(input)
      .resize(slot.width, slot.height, {
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .webp({ quality: DISPLAY_WEBP_QUALITY })
      .toBuffer();
    return { original, display, width: slot.width, height: slot.height };
  }

  /** Normalise any stored image to a PNG no larger than a provider needs. */
  async toReference(input: Buffer): Promise<Buffer> {
    return sharp(input)
      .resize(REFERENCE_MAX_SIDE, REFERENCE_MAX_SIDE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  }
}
