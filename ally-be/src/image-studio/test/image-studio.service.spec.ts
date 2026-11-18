import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImageSlotKind } from '../constants/image-slots.constants';
import { GeneratedImageStatus } from '../entity/generated-image.entity';
import { ImageStudioService } from '../service/image-studio.service';

const user = { id: 7, username: 'trainer', tenantId: 'tenant-a' };

const studioConfig = (overrides: Record<string, unknown> = {}) => ({
  imageStudio: {
    enabled: true,
    maxActivePerUser: 12,
    maxReferences: 5,
    quality: 'medium',
    textProvider: 'openai',
    referenceProvider: 'gemini',
    costPerImageUsd: 0,
    ...overrides,
  },
  openai: { apiKey: 'sk-test', imageModel: 'gpt-image-1.5' },
  gemini: { apiKey: 'g-test', imageModel: 'gemini-2.5-flash-image' },
  ...(overrides.noKeys
    ? {
        openai: { imageModel: 'gpt-image-1.5' },
        gemini: { imageModel: 'gemini-2.5-flash-image' },
      }
    : {}),
});

const safeCompose = () => ({
  compose: jest.fn().mockResolvedValue({
    safety: { ok: true },
    description: 'Ravi sits on his bed, phone in hand.',
    altText: 'A young man on his bed with a phone',
    scene: { shot: 'medium' },
    composed: true,
  }),
});

const build = (
  options: {
    config?: Record<string, unknown>;
    compose?: { compose: jest.Mock };
    rows?: any[];
    castSheets?: any[];
    active?: number;
    characters?: any[];
    track?: any;
  } = {},
) => {
  const repository = {
    create: jest.fn((row) => ({
      id: `row-${Math.random()}`,
      createdAt: new Date(),
      ...row,
    })),
    save: jest.fn(async (rows) => rows),
    countActiveFor: jest.fn().mockResolvedValue(options.active ?? 0),
    findForTenant: jest.fn().mockResolvedValue(options.rows ?? []),
    findCastSheets: jest.fn().mockResolvedValue(options.castSheets ?? []),
    findHistory: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const compose = options.compose ?? safeCompose();
  const assets = {
    url: (key: string) => `https://learn-media.s3.r.amazonaws.com/${key}`,
    locate: jest.fn((url: string) => {
      if (!url.includes('learn-media'))
        throw new BadRequestException('not ours');
      return { bucket: 'learn-media', key: url.split('.com/')[1] };
    }),
  };
  const worker = { kick: jest.fn() };
  const characters = {
    find: jest.fn().mockResolvedValue(options.characters ?? []),
  };
  const tracks = {
    findOne: jest.fn().mockResolvedValue(options.track ?? null),
    update: jest.fn(),
  };
  const service = new ImageStudioService(
    studioConfig(options.config) as any,
    repository as any,
    compose as any,
    assets as any,
    worker as any,
    characters as any,
    tracks as any,
  );
  return { service, repository, compose, assets, worker, characters, tracks };
};

const request = (overrides: Record<string, unknown> = {}) => ({
  slotKind: ImageSlotKind.SCENE,
  styleId: 'cinematic_photo',
  description: 'Ravi on his bed at night',
  ...overrides,
});

describe('ImageStudioService.generate', () => {
  it('queues one row per variation with the compiled prompt and returns at once', async () => {
    const { service, repository, worker } = build();
    const result = await service.generate(
      user,
      request({ variants: 3, slotKey: 'track:t:item:i:node:n' }) as any,
    );
    expect(result.images).toHaveLength(3);
    expect(result.images.every((image) => image.status === 'queued')).toBe(
      true,
    );
    const saved = repository.save.mock.calls[0][0];
    expect(saved[0]).toMatchObject({
      tenantId: 'tenant-a',
      createdBy: 7,
      slotKey: 'track:t:item:i:node:n',
      styleId: 'cinematic_photo',
      description: 'Ravi on his bed at night',
      altText: 'A young man on his bed with a phone',
    });
    expect(saved[0].prompt).toContain('Ravi sits on his bed, phone in hand.');
    expect(saved[0].prompt).toContain('No text, letters');
    expect(new Set(saved.map((row: any) => row.batchId)).size).toBe(1);
    expect(worker.kick).toHaveBeenCalled();
  });

  it('uses the slot’s default variation count', async () => {
    const { service } = build();
    const cover = await service.generate(
      user,
      request({
        slotKind: ImageSlotKind.COURSE_COVER,
        styleId: 'documentary_photo',
      }) as any,
    );
    expect(cover.images).toHaveLength(2);
  });

  it('refuses a blocked request with the reason and a suggestion, queuing nothing', async () => {
    const compose = {
      compose: jest.fn().mockResolvedValue({
        safety: {
          ok: false,
          reason: 'Shows a method.',
          suggestion: 'Show the emotion.',
        },
        description: '',
        altText: '',
        scene: null,
        composed: true,
      }),
    };
    const { service, repository } = build({ compose });
    const error = await service
      .generate(user, request() as any)
      .catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({
      safety: { ok: false, suggestion: 'Show the emotion.' },
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('refuses when the author already has too many images in flight', async () => {
    const { service } = build({ active: 11 });
    const error = await service
      .generate(user, request({ variants: 2 }) as any)
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
  });

  it('refuses everything when Image Studio is off', async () => {
    const { service } = build({ config: { enabled: false } });
    await expect(
      service.generate(user, request() as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports itself off, and refuses, when no image provider has a key', async () => {
    const { service } = build({ config: { noKeys: true } });
    expect(service.getConfig().enabled).toBe(false);
    await expect(
      service.generate(user, request() as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses an unknown style', async () => {
    const { service } = build();
    await expect(
      service.generate(user, request({ styleId: 'vaporwave' }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a reference URL outside our buckets', async () => {
    const { service } = build();
    await expect(
      service.generate(
        user,
        request({
          references: [{ role: 'setting', url: 'https://evil.example/x.png' }],
        }) as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a reference image from another tenant (it is simply not found)', async () => {
    const { service } = build({ rows: [] });
    await expect(
      service.generate(
        user,
        request({
          references: [
            {
              role: 'previous',
              imageId: '0f8fad5b-d9cb-469f-a165-70867728950e',
            },
          ],
        }) as any,
      ),
    ).rejects.toThrow(/missing or not finished/);
  });

  it('adds each cast member’s cast sheet, orders by identity first and caps the references', async () => {
    const ids = ['c1', 'c2'];
    const { service, repository } = build({
      config: { maxReferences: 3 },
      characters: [
        { id: 'c1', name: 'Ravi', appearance: 'short beard, blue kurta' },
        {
          id: 'c2',
          name: 'Meera',
          age: 40,
          gender: 'female',
          profession: 'counsellor',
        },
      ],
      castSheets: [
        { id: 'sheet-1', characterId: 'c1' },
        { id: 'sheet-2', characterId: 'c2' },
      ],
      rows: [
        {
          id: 'style-1',
          status: GeneratedImageStatus.SUCCEEDED,
          originalKey: 'k1',
        },
        {
          id: 'prev-1',
          status: GeneratedImageStatus.SUCCEEDED,
          originalKey: 'k2',
        },
      ],
    });
    await service.generate(
      user,
      request({
        castCharacterIds: ids,
        references: [
          { role: 'style', imageId: 'style-1' },
          { role: 'previous', imageId: 'prev-1', label: 'Scene 2' },
        ],
      }) as any,
    );
    const row = repository.save.mock.calls[0][0][0];
    expect(row.references.map((r: any) => r.imageId)).toEqual([
      'sheet-1',
      'sheet-2',
      'prev-1',
    ]);
    expect(row.castCharacterIds).toEqual(ids);
    expect(row.prompt).toContain('Ravi — short beard, blue kurta');
    expect(row.prompt).toContain('Meera — 40 years old, female, counsellor');
  });

  it('puts the image being refined first and records it', async () => {
    const { service, repository } = build({
      rows: [
        {
          id: 'img-1',
          status: GeneratedImageStatus.SUCCEEDED,
          originalKey: 'k',
        },
      ],
    });
    await service.generate(
      user,
      request({
        refine: { imageId: 'img-1', instruction: 'make her look more worried' },
      }) as any,
    );
    const row = repository.save.mock.calls[0][0][0];
    expect(row.references[0]).toEqual({ role: 'refine', imageId: 'img-1' });
    expect(row.refinedFromId).toBe('img-1');
    expect(
      row.prompt.startsWith(
        'Edit the attached image. Change only this: make her look more worried',
      ),
    ).toBe(true);
  });

  it('records the character a cast sheet belongs to', async () => {
    const { service, repository } = build({
      characters: [{ id: 'c1', name: 'Ravi' }],
    });
    await service.generate(
      user,
      request({
        slotKind: ImageSlotKind.CAST_SHEET,
        styleId: 'graphic_novel',
        castCharacterIds: ['c1'],
      }) as any,
    );
    expect(repository.save.mock.calls[0][0][0].characterId).toBe('c1');
  });
});

describe('ImageStudioService.generateBatch', () => {
  it('makes one image per item and turns a blocked item into a failed image with the reason', async () => {
    const compose = {
      compose: jest
        .fn()
        .mockResolvedValueOnce({
          safety: { ok: true },
          description: 'a',
          altText: 'a',
          scene: null,
          composed: true,
        })
        .mockResolvedValueOnce({
          safety: {
            ok: false,
            reason: 'Shows an injury.',
            suggestion: 'Show the emotion.',
          },
          description: '',
          altText: '',
          scene: null,
          composed: true,
        }),
    };
    const { service } = build({ compose });
    const result = await service.generateBatch(user, [
      request({ variants: 4 }),
      request(),
    ] as any);
    expect(result.images).toHaveLength(2);
    expect(result.images[0].status).toBe('queued');
    expect(result.images[1]).toMatchObject({
      status: 'failed',
      error: 'Shows an injury. Show the emotion.',
    });
  });
});

describe('ImageStudioService batch matching and cast sheets', () => {
  it('echoes each image’s slotKey so the editor can match a batch to its scenes', async () => {
    const { service } = build();
    const result = await service.generateBatch(user, [
      request({ slotKey: 'node:a' }),
      request({ slotKey: 'node:b' }),
    ] as any);
    expect(result.images.map((image) => image.slotKey)).toEqual([
      'node:a',
      'node:b',
    ]);
  });

  it('lists cast sheets for every style when no style is named', async () => {
    const { service, repository } = build({
      castSheets: [
        {
          id: 's1',
          characterId: 'c1',
          styleId: 'graphic_novel',
          status: GeneratedImageStatus.SUCCEEDED,
          references: [],
          createdAt: new Date(),
        },
      ],
    });
    const sheets = await service.castSheets(user, ['c1']);
    expect(repository.findCastSheets).toHaveBeenCalledWith(
      'tenant-a',
      ['c1'],
      undefined,
    );
    expect(sheets[0]).toMatchObject({
      characterId: 'c1',
      styleId: 'graphic_novel',
    });
  });
});

describe('ImageStudioService.estimate', () => {
  it('prices a batch at one image per item, with references on the reference model', () => {
    const { service } = build();
    const estimate = service.estimate({
      items: [request({ castCharacterIds: ['a'] }), request()] as any,
    });
    expect(estimate.images).toBe(2);
    expect(estimate.totalUsd).toBeGreaterThan(0);
    expect(estimate.perImageUsd).toBeLessThan(0.2);
  });
});

describe('ImageStudioService.accept', () => {
  const succeeded = {
    id: 'img-1',
    status: GeneratedImageStatus.SUCCEEDED,
    slotKind: ImageSlotKind.SCENE,
    styleId: 'graphic_novel',
    references: [],
    createdAt: new Date(),
  };

  it('marks the image used and makes it the course’s style example when there is none', async () => {
    const { service, repository, tracks } = build({
      rows: [{ ...succeeded }],
      track: { id: 't1', imageStyleId: null, imageStyleAnchorId: null },
    });
    const result = await service.accept(user, 'img-1', 't1');
    expect(result.acceptedAt).toBeDefined();
    expect(repository.update).toHaveBeenCalledWith(
      'img-1',
      expect.objectContaining({ acceptedAt: expect.any(Date) }),
    );
    expect(tracks.update).toHaveBeenCalledWith('t1', {
      imageStyleAnchorId: 'img-1',
      imageStyleId: 'graphic_novel',
    });
  });

  it('leaves an existing style example, and ignores an image in another style', async () => {
    const withAnchor = build({
      rows: [{ ...succeeded }],
      track: {
        id: 't1',
        imageStyleId: 'graphic_novel',
        imageStyleAnchorId: 'old',
      },
    });
    await withAnchor.service.accept(user, 'img-1', 't1');
    expect(withAnchor.tracks.update).not.toHaveBeenCalled();
    const otherStyle = build({
      rows: [{ ...succeeded }],
      track: {
        id: 't1',
        imageStyleId: 'watercolour',
        imageStyleAnchorId: null,
      },
    });
    await otherStyle.service.accept(user, 'img-1', 't1');
    expect(otherStyle.tracks.update).not.toHaveBeenCalled();
  });

  it('never makes a badge icon a style example', async () => {
    const { service, tracks } = build({
      rows: [{ ...succeeded, slotKind: ImageSlotKind.BADGE_ICON }],
      track: { id: 't1', imageStyleId: null, imageStyleAnchorId: null },
    });
    await service.accept(user, 'img-1', 't1');
    expect(tracks.findOne).not.toHaveBeenCalled();
  });
});

describe('ImageStudioService catalogue', () => {
  it('lists every style with a thumbnail URL and every slot with its shape', () => {
    const { service } = build();
    const styles = service.getStyles();
    expect(styles.length).toBeGreaterThanOrEqual(6);
    expect(styles[0].thumbnailUrl).toMatch(/image-studio\/styles\/.+\.webp$/);
    const roleplay = service
      .getSlots()
      .find((slot) => slot.kind === ImageSlotKind.ROLEPLAY_COVER)!;
    expect(roleplay).toMatchObject({
      width: 1600,
      height: 900,
      aspectRatio: '16:9',
    });
  });
});
