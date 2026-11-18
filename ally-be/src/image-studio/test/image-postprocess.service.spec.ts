// sharp 0.35's package-level `types` are its ESM typings; this CommonJS build gets
// `module.exports = sharp`, which its CJS typings describe (as in chatbot/bot-image).
import type sharpCjs = require('sharp/dist/index.cjs');
import {
  getSlotProfile,
  ImageSlotKind,
} from '../constants/image-slots.constants';
import { ImagePostprocessService } from '../service/image-postprocess.service';

const sharp: typeof sharpCjs = require('sharp');

const providerPng = () =>
  sharp({
    create: { width: 1536, height: 1024, channels: 3, background: '#88aacc' },
  })
    .png()
    .toBuffer();

describe('ImagePostprocessService', () => {
  const service = new ImagePostprocessService();

  it('crops a 3:2 provider image to the slot’s exact 16:9 size, as WebP', async () => {
    const slot = getSlotProfile(ImageSlotKind.ROLEPLAY_COVER);
    const result = await service.process(await providerPng(), slot);
    const meta = await sharp(result.display).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(900);
    expect(
      Math.abs((meta.width as number) / (meta.height as number) - 16 / 9),
    ).toBeLessThan(0.01);
    expect((await sharp(result.original).metadata()).format).toBe('png');
  });

  it('crops square slots square', async () => {
    const result = await service.process(
      await providerPng(),
      getSlotProfile(ImageSlotKind.BADGE_ICON),
    );
    const meta = await sharp(result.display).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('shrinks a reference to at most 1024 px on its longest side', async () => {
    const reference = await service.toReference(await providerPng());
    const meta = await sharp(reference).metadata();
    expect(Math.max(meta.width as number, meta.height as number)).toBe(1024);
    expect(meta.format).toBe('png');
  });
});
