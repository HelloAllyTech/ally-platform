// sharp 0.35's package-level `types` are its ESM typings; this CommonJS build gets
// `module.exports = sharp`, which its CJS typings describe (as in chatbot/bot-image).
import type sharpCjs = require('sharp/dist/index.cjs');
import { ImageSlotKind } from '../constants/image-slots.constants';
import { GeneratedImage } from '../entity/generated-image.entity';
import {
  ImageRenderError,
  ImageRenderService,
} from '../service/image-render.service';
import { ImagePostprocessService } from '../service/image-postprocess.service';

const sharp: typeof sharpCjs = require('sharp');

const png = () =>
  sharp({
    create: { width: 1536, height: 1024, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer();

const provider = (name: string, impl: jest.Mock, maxReferences = 6) => ({
  getModel: () => `${name}-model`,
  assertConfigured: () => undefined,
  maxReferences: () => maxReferences,
  generateImage: impl,
});

const config = (overrides: Record<string, unknown> = {}) =>
  ({
    imageStudio: {
      textProvider: 'openai',
      referenceProvider: 'gemini',
      quality: 'medium',
      costPerImageUsd: 0,
      ...overrides,
    },
  }) as any;

const build = async (options: {
  openai?: jest.Mock;
  gemini?: jest.Mock;
  judge?: jest.Mock;
  sources?: Record<string, Partial<GeneratedImage>>;
}) => {
  const image = await png();
  const openai = provider(
    'gpt-image',
    options.openai ?? jest.fn().mockResolvedValue(image),
    16,
  );
  const gemini = provider(
    'gemini',
    options.gemini ?? jest.fn().mockResolvedValue(image),
  );
  const factory = {
    getProvider: jest.fn((type: string) => {
      if (type === 'openai')
        return { provider: openai, providerType: 'openai' };
      if (type === 'gemini')
        return { provider: gemini, providerType: 'gemini' };
      throw new Error('unknown');
    }),
  };
  const repository = {
    findOne: jest.fn(
      async ({ where: { id } }) => options.sources?.[id] ?? null,
    ),
  };
  const assets = {
    bucket: 'learn-media',
    read: jest.fn().mockResolvedValue(image),
    put: jest.fn(),
    originalKey: (id: string) => `image-studio/originals/${id}.png`,
    displayKey: (id: string) => `image-studio/${id}.webp`,
    url: (key: string) => `https://learn-media.s3.r.amazonaws.com/${key}`,
  };
  const judge = {
    check:
      options.judge ??
      jest.fn().mockResolvedValue({ passed: true, issues: [] }),
  };
  const usage = { record: jest.fn() };
  const service = new ImageRenderService(
    config(),
    factory as any,
    repository as any,
    assets as any,
    new ImagePostprocessService(),
    judge as any,
    usage as any,
  );
  return { service, openai, gemini, assets, judge, usage, image };
};

const row = (overrides: Partial<GeneratedImage> = {}): GeneratedImage =>
  ({
    id: 'img-1',
    tenantId: 'tenant-a',
    slotKind: ImageSlotKind.SCENE,
    styleId: 'cinematic_photo',
    description: 'Ravi on his bed',
    prompt: 'PROMPT',
    references: [],
    sceneSpec: null,
    ...overrides,
  }) as GeneratedImage;

describe('ImageRenderService', () => {
  it('sends a text-only image to the text provider and stores both copies', async () => {
    const { service, openai, gemini, assets } = await build({});
    const { patch } = await service.render(row());
    expect(openai.generateImage).toHaveBeenCalledWith(
      'PROMPT',
      '1536x1024',
      expect.objectContaining({ quality: 'medium' }),
    );
    expect(gemini.generateImage).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledWith(
      'image-studio/originals/img-1.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(assets.put).toHaveBeenCalledWith(
      'image-studio/img-1.webp',
      expect.any(Buffer),
      'image/webp',
    );
    expect(patch).toMatchObject({
      provider: 'openai',
      imageUrl:
        'https://learn-media.s3.r.amazonaws.com/image-studio/img-1.webp',
      width: 1920,
      height: 1080,
      check: { passed: true, issues: [] },
    });
    expect(Number(patch.costUsd)).toBeGreaterThan(0);
  });

  it('sends an image with references to the reference provider, with the references attached', async () => {
    const { service, gemini } = await build({
      sources: {
        ref: {
          id: 'ref',
          tenantId: 'tenant-a',
          originalKey: 'image-studio/originals/ref.png',
        },
      },
    });
    await service.render(
      row({
        references: [{ role: 'character', label: 'Ravi', imageId: 'ref' }],
      }),
    );
    const options = gemini.generateImage.mock.calls[0][2];
    expect(options.references).toHaveLength(1);
    expect(options.references[0].mimeType).toBe('image/png');
  });

  it('never loads a reference that belongs to another tenant', async () => {
    const { service, gemini, openai } = await build({
      sources: { ref: { id: 'ref', tenantId: 'tenant-b', originalKey: 'k' } },
    });
    await service.render(
      row({ references: [{ role: 'character', imageId: 'ref' }] }),
    );
    expect(gemini.generateImage).not.toHaveBeenCalled();
    expect(openai.generateImage.mock.calls[0][2].references).toBeUndefined();
  });

  it('falls back to the other provider on an outage', async () => {
    const { service, openai, gemini } = await build({
      openai: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('overloaded'), { status: 503 }),
        ),
    });
    const { patch } = await service.render(row());
    expect(openai.generateImage).toHaveBeenCalled();
    expect(gemini.generateImage).toHaveBeenCalled();
    expect(patch.provider).toBe('gemini');
  });

  it('does not retry a content refusal elsewhere, and tells the author how to fix it', async () => {
    const { service, gemini } = await build({
      openai: jest.fn().mockRejectedValue(
        Object.assign(new Error('blocked'), {
          status: 400,
          code: 'moderation_blocked',
        }),
      ),
    });
    const error = await service.render(row()).catch((e) => e);
    expect(error).toBeInstanceOf(ImageRenderError);
    expect(error.authorMessage).toMatch(/emotion and setting/);
    expect(gemini.generateImage).not.toHaveBeenCalled();
  });

  it('regenerates once, told what was wrong, when the check fails', async () => {
    const judge = jest
      .fn()
      .mockResolvedValueOnce({
        passed: false,
        issues: ['There is text on the wall.'],
      })
      .mockResolvedValueOnce({ passed: true, issues: [] });
    const { service, openai } = await build({ judge });
    const { patch } = await service.render(row());
    expect(openai.generateImage).toHaveBeenCalledTimes(2);
    expect(openai.generateImage.mock.calls[1][0]).toContain(
      'Avoid these problems from a previous attempt: There is text on the wall.',
    );
    expect(patch.check).toEqual({ passed: true, issues: [] });
  });

  it('keeps the first image, flagged, when the retry itself fails', async () => {
    const image = await png();
    const judge = jest
      .fn()
      .mockResolvedValue({ passed: false, issues: ['Extra fingers.'] });
    const { service } = await build({
      judge,
      openai: jest
        .fn()
        .mockResolvedValueOnce(image)
        .mockRejectedValueOnce(
          Object.assign(new Error('bad'), { status: 400 }),
        ),
      gemini: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('bad'), { status: 400 })),
    });
    const { patch } = await service.render(row());
    expect(patch.check).toEqual({ passed: false, issues: ['Extra fingers.'] });
    expect(patch.imageUrl).toBeDefined();
  });

  it('reports a server with no image provider configured in words an author understands', async () => {
    const { service } = await build({});
    (service as any).providerFactory.getProvider = () => {
      throw new Error('no key');
    };
    await expect(service.render(row())).rejects.toThrow(/not set up/);
  });
});
