// sharp's package-level `types` are its ESM typings; this CommonJS build gets `module.exports =
// sharp` at run time, which its CJS typings describe. The type import is erased.
import type sharpCjs = require('sharp/dist/index.cjs');

const sharp: typeof sharpCjs = require('sharp');
import {
  IMAGE_MAX_BYTES,
  ImageCheckError,
  processImage,
  sniffImageType,
  svgIsSelfContained,
} from '../image-check';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#C4512D' } });

const problemOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageCheckError) return error.problem;
    throw error;
  }
  return 'accepted';
};

describe('image checks (chunk 20d)', () => {
  it('knows the type from the bytes, not the name', async () => {
    expect(sniffImageType(await solid(4, 4).png().toBuffer())).toBe('png');
    expect(sniffImageType(await solid(4, 4).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImageType(await solid(4, 4).webp().toBuffer())).toBe('webp');
    expect(
      sniffImageType(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>')),
    ).toBe('svg');
    // A Windows executable renamed to logo.png starts "MZ".
    expect(
      sniffImageType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00')),
    ).toBeNull();
  });

  it('refuses an .exe renamed as .png', async () => {
    const exe = Buffer.concat([
      Buffer.from('MZ\x90\x00'),
      Buffer.alloc(2000, 1),
    ]);
    expect(await problemOf(processImage(exe, { allowSvg: true }))).toBe(
      'wrong_type',
    );
  });

  it('refuses anything over 5 MB', async () => {
    const big = Buffer.concat([
      await solid(4, 4).png().toBuffer(),
      Buffer.alloc(IMAGE_MAX_BYTES),
    ]);
    expect(await problemOf(processImage(big, { allowSvg: false }))).toBe(
      'too_large',
    );
  });

  it('refuses too many pixels', async () => {
    const wide = await solid(6001, 2).png().toBuffer();
    expect(await problemOf(processImage(wide, { allowSvg: false }))).toBe(
      'too_many_pixels',
    );
  });

  it('removes EXIF and GPS, and turns the image upright first', async () => {
    const withGps = await solid(120, 60)
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { ImageDescription: 'Home', Copyright: 'Owner' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 31/1 0/1' },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const out = await processImage(withGps, { allowSvg: false });
    const meta = await sharp(out.original.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.original.bytes.includes(Buffer.from('GPS'))).toBe(false);
    expect(out.original.bytes.includes(Buffer.from('Home'))).toBe(false);
    // Orientation 6 is a quarter turn: 120 × 60 stored, 60 × 120 seen.
    expect([out.width, out.height]).toEqual([60, 120]);
    for (const variant of out.variants) {
      expect((await sharp(variant.bytes).metadata()).exif).toBeUndefined();
    }
  });

  it('makes 256, 768 and 1600 px WebP variants, never enlarged', async () => {
    const out = await processImage(await solid(2000, 1000).png().toBuffer(), {
      allowSvg: false,
    });
    const widths = await Promise.all(
      out.variants.map(async (v) => {
        const meta = await sharp(v.bytes).metadata();
        expect(meta.format).toBe('webp');
        return [v.width, meta.width];
      }),
    );
    expect(widths).toEqual([
      [256, 256],
      [768, 768],
      [1600, 1600],
    ]);
    const small = await processImage(await solid(300, 300).png().toBuffer(), {
      allowSvg: false,
    });
    expect(
      await Promise.all(
        small.variants.map(
          async (v) => (await sharp(v.bytes).metadata()).width,
        ),
      ),
    ).toEqual([256, 300, 300]);
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rasterises a clean SVG logo to PNG, and only for logos', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#C4512D"/></svg>',
    );
    expect(await problemOf(processImage(svg, { allowSvg: false }))).toBe(
      'wrong_type',
    );
    const out = await processImage(svg, { allowSvg: true });
    expect(out.type).toBe('svg');
    expect(out.original.contentType).toBe('image/png');
    expect((await sharp(out.original.bytes).metadata()).format).toBe('png');
    expect(out.width).toBe(1024);
  });

  it('refuses an SVG with a script, foreignObject, external reference or entities', async () => {
    const cases = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="file:///etc/passwd"/></svg>',
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/p)"/></svg>',
    ];
    for (const text of cases) {
      expect(svgIsSelfContained(text)).toBe(false);
      expect(
        await problemOf(processImage(Buffer.from(text), { allowSvg: true })),
      ).toBe('wrong_type');
    }
    expect(
      svgIsSelfContained(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>',
      ),
    ).toBe(true);
  });
});
