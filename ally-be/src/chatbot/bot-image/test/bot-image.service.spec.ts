import { HttpException, NotFoundException } from '@nestjs/common';
// sharp's package-level `types` are its ESM typings; this CommonJS build gets `module.exports =
// sharp` at run time, which its CJS typings describe. The type import is erased.
import type sharpCjs = require('sharp/dist/index.cjs');

const sharp: typeof sharpCjs = require('sharp');
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import {
  darkenForWhiteText,
  contrastRatio,
} from '../../../tenant/util/brand-colour.util';
import { BotPageService } from '../../bot-page/bot-page.service';
import { BotPageAccess, BotPageStatus } from '../../enum/bot-page.enum';
import { ChatbotStatus } from '../../enum/chatbot.enum';
import { BotImage, BotImageKind, BotImageStatus } from '../bot-image.entity';
import {
  BotImageService,
  IMAGE_ERRORS,
  MAX_IMAGES_PER_BOT,
} from '../bot-image.service';
import { fileStem } from '../urls';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const bot = {
  id: 'bot-1',
  name: 'Sunrise Mind',
  status: ChatbotStatus.LIVE,
  persona: { displayName: 'Sunny' },
  settings: {},
};

/** A tiny in-memory repository: enough of TypeORM's find/count/save for these tests. */
function memoryRepo<T extends { id?: string }>(rows: T[]) {
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, want]) => {
      const value = (row as Record<string, unknown>)[key];
      if (want && typeof want === 'object' && '_type' in (want as object)) {
        const op = want as { _type: string; _value: unknown };
        if (op._type === 'in') return (op._value as unknown[]).includes(value);
        if (op._type === 'lessThan')
          return value instanceof Date && value < (op._value as Date);
        if (op._type === 'raw') {
          // The page's case-insensitive slug lookup.
          const params = (
            want as { _objectLiteralParameters?: { slug?: string } }
          )._objectLiteralParameters;
          return (
            String(value).toLowerCase() === String(params?.slug).toLowerCase()
          );
        }
        return false;
      }
      return value === want;
    });
  return {
    rows,
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => matches(r, where)) ?? null,
    ),
    count: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => matches(r, where)).length,
    ),
    create: jest.fn((row: T) => row),
    save: jest.fn(async (row: T) => {
      if (!row.id) row.id = `img-${rows.length + 1}`;
      const at = rows.findIndex((r) => r.id === row.id);
      if (at >= 0) rows[at] = { ...rows[at], ...row };
      else rows.push(row);
      return row;
    }),
  };
}

describe('BotImageService and the page brand (chunk 20d)', () => {
  let images: ReturnType<typeof memoryRepo<BotImage>>;
  let pageRows: Record<string, unknown>[];
  let pagesRepo: ReturnType<typeof memoryRepo<Record<string, unknown>>>;
  let s3: {
    uploadStream: jest.Mock;
    getObjectBuffer: jest.Mock;
    deleteObject: jest.Mock;
    generatePresignedUrl: jest.Mock;
  };
  let pageService: BotPageService;
  let service: BotImageService;
  let png: Buffer;

  const config = {
    botPage: { baseUrl: 'http://localhost:8081' },
    s3: { assetsBucket: 'assets', botImagesBucket: 'private-bucket' },
    publicApiBaseUrl: 'http://localhost:8001',
  };

  const livePage = (brand: Record<string, unknown> = {}) => {
    pageRows.push({
      id: 'page-1',
      chatbotId: bot.id,
      slug: 'sunrise-mind',
      status: BotPageStatus.ON,
      access: BotPageAccess.INVITE,
      settings: {
        brand: { headingStyle: 'classic', theme: 'light', ...brand },
      },
    });
  };

  beforeAll(async () => {
    png = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#C4512D' },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    images = memoryRepo<BotImage>([]);
    pageRows = [];
    pagesRepo = memoryRepo(pageRows);
    s3 = {
      uploadStream: jest.fn().mockResolvedValue({}),
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-bytes')),
      deleteObject: jest.fn().mockResolvedValue({}),
      generatePresignedUrl: jest.fn(
        async ({ key }: { key: string }) =>
          `https://signed/${key}?X-Amz-Expires=900`,
      ),
    };
    pageService = new BotPageService(
      pagesRepo as never,
      { findOne: jest.fn().mockResolvedValue(bot) } as never,
      {
        getForChatbot: jest.fn(async () => ({
          ...DEFAULT_WHATSAPP_SETTINGS,
          enabled: true,
        })),
      } as never,
      {} as never,
      config as never,
      images as never,
    );
    service = new BotImageService(
      images as never,
      pageService,
      s3 as never,
      {
        incrWithExpiry: jest
          .fn()
          .mockResolvedValue({ count: 1, ttlSeconds: 60 }),
      } as never,
      config as never,
    );
  });

  describe('upload', () => {
    it('stores the variants and the original privately, under tenant and bot, by content hash', async () => {
      const view = await service.upload(
        bot.id,
        { buffer: png, originalname: 'cover.png' },
        BotImageKind.COVER,
      );
      const keys = s3.uploadStream.mock.calls.map(([params]) => params.Key);
      const stem = fileStem(images.rows[0]);
      expect(keys.sort()).toEqual(
        [
          `bot-images/tenant-1/bot-1/${stem}-1600.webp`,
          `bot-images/tenant-1/bot-1/${stem}-256.webp`,
          `bot-images/tenant-1/bot-1/${stem}-768.webp`,
          `bot-images/tenant-1/bot-1/${stem}-original.png`,
        ].sort(),
      );
      expect(
        s3.uploadStream.mock.calls.every(
          ([p]) => p.Bucket === 'private-bucket',
        ),
      ).toBe(true);
      expect(view.fileName).toBe('cover.png');
      // The dashboard gets short-lived signed URLs, not public ones.
      expect(view.urls[768]).toMatch(/^https:\/\/signed\/.*X-Amz-Expires=900/);
    });

    it('returns the existing image for the same bytes', async () => {
      const first = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.COVER,
      );
      const again = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.COVER,
      );
      expect(again.id).toBe(first.id);
      expect(images.rows).toHaveLength(1);
    });

    it('refuses a 51st image with the copy deck line', async () => {
      for (let i = 0; i < MAX_IMAGES_PER_BOT; i++) {
        images.rows.push({
          id: `old-${i}`,
          chatbotId: bot.id,
          status: BotImageStatus.ATTACHED,
        } as BotImage);
      }
      await expect(
        service.upload(bot.id, { buffer: png }, BotImageKind.COVER),
      ).rejects.toMatchObject({
        response: { code: 'too_many', message: IMAGE_ERRORS.too_many },
      });
    });

    it('refuses an .exe named .png with the wrong-type line, and stores nothing', async () => {
      const exe = Buffer.concat([
        Buffer.from('MZ\x90\x00'),
        Buffer.alloc(64, 1),
      ]);
      const error = await service
        .upload(
          bot.id,
          { buffer: exe, originalname: 'photo.png' },
          BotImageKind.COVER,
        )
        .catch((e: HttpException) => e);
      expect((error as HttpException).getResponse()).toMatchObject({
        message: IMAGE_ERRORS.wrong_type,
      });
      expect(s3.uploadStream).not.toHaveBeenCalled();
    });

    it('limits uploads per user per minute', async () => {
      service = new BotImageService(
        images as never,
        pageService,
        s3 as never,
        {
          incrWithExpiry: jest
            .fn()
            .mockResolvedValue({ count: 31, ttlSeconds: 30 }),
        } as never,
        config as never,
      );
      await expect(
        service.upload(bot.id, { buffer: png }, BotImageKind.COVER),
      ).rejects.toMatchObject({
        status: 429,
      });
    });
  });

  describe('visibility', () => {
    it("doesn't serve a draft's image: the page isn't live", async () => {
      const view = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.COVER,
      );
      pageRows.push({
        id: 'page-1',
        chatbotId: bot.id,
        slug: 'sunrise-mind',
        status: BotPageStatus.OFF,
        access: BotPageAccess.INVITE,
        settings: { brand: { coverImage: view.id } },
      });
      const stem = fileStem(images.rows[0]);
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serves a live page’s image only while its brand uses it, and never the original', async () => {
      const view = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.COVER,
      );
      const stem = fileStem(images.rows[0]);
      livePage({ coverImage: view.id });
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).resolves.toMatchObject({
        contentType: 'image/webp',
      });
      await expect(
        service.publicFile('sunrise-mind', `${stem}-original.png`),
      ).rejects.toBeInstanceOf(NotFoundException);
      (
        pageRows[0].settings as { brand: Record<string, unknown> }
      ).brand.coverImage = null;
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stops serving a removed image at once, restores it on Undo, and deletes its files after 30 days', async () => {
      const view = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.COVER,
      );
      const stem = fileStem(images.rows[0]);
      livePage({ coverImage: view.id });

      await service.detach(bot.id, view.id);
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).rejects.toBeInstanceOf(NotFoundException);
      await service.restore(bot.id, view.id);
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).resolves.toBeDefined();

      await service.detach(bot.id, view.id);
      expect(await service.purge(new Date(Date.now() + 10 * 86_400_000))).toBe(
        0,
      );
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(await service.purge(new Date(Date.now() + 31 * 86_400_000))).toBe(
        1,
      );
      expect(s3.deleteObject).toHaveBeenCalledTimes(4);
      expect(images.rows[0].status).toBe(BotImageStatus.PURGED);
      await expect(service.restore(bot.id, view.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.publicFile('sunrise-mind', `${stem}-768.webp`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('brand', () => {
    it('stores the colour as chosen and a copy white text reads on (4.5:1)', async () => {
      const view = await pageService.saveBrand(bot as never, {
        accent: '#F4A261',
      });
      expect(view.settings.brand.accent).toBe('#F4A261');
      const corrected = view.settings.brand.accentContrast!;
      expect(contrastRatio(corrected, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(darkenForWhiteText('#17171C')).toBe('#17171C');
    });

    it('creates the page, off, before its first save', async () => {
      const view = await pageService.saveBrand(bot as never, {
        headingStyle: 'friendly',
        theme: 'dark',
      });
      expect(pageRows).toHaveLength(1);
      expect(view.status).toBe(BotPageStatus.OFF);
      expect(view.settings.brand).toMatchObject({
        headingStyle: 'friendly',
        theme: 'dark',
      });
    });

    it("refuses another bot's image, or a removed one", async () => {
      images.rows.push({
        id: 'other',
        chatbotId: 'bot-2',
        status: BotImageStatus.ATTACHED,
      } as BotImage);
      images.rows.push({
        id: 'gone',
        chatbotId: bot.id,
        status: BotImageStatus.DETACHED,
      } as BotImage);
      await expect(
        pageService.saveBrand(bot as never, { logo: 'other' }),
      ).rejects.toThrow(/no longer/);
      await expect(
        pageService.saveBrand(bot as never, { coverImage: 'gone' }),
      ).rejects.toThrow(/no longer/);
    });

    it('keeps the brand when the Bot page tab saves, and ignores a brand sent there', async () => {
      await pageService.saveBrand(bot as never, {
        accent: '#C4512D',
        headingStyle: 'modern',
      });
      await pageService.save(
        bot as never,
        {
          status: BotPageStatus.ON,
          slug: 'sunrise-mind',
          access: BotPageAccess.INVITE,
          settings: {
            branding: {
              logoUrl: null,
              accentColour: '#336699',
              title: 'Sunrise Mind',
              subtitle: '',
              assistantName: 'Sunny',
              avatarUrl: null,
              disclaimer: '',
              footerLink: null,
            },
            brand: { headingStyle: 'friendly', accentContrast: '#FFFFFF' },
            suggestedQuestions: [],
            prechat: [],
            limits: {
              messagesPerVisitorPerHour: 30,
              maxMessageChars: 1000,
              dailyCapPerBot: 500,
            },
            language: 'auto',
          },
        } as never,
      );
      const stored = (
        pageRows[0].settings as { brand: Record<string, unknown> }
      ).brand;
      expect(stored.headingStyle).toBe('modern');
      expect(stored.accent).toBe('#C4512D');
    });

    it('gives visitors the corrected colour and the logo on the public image route', async () => {
      const logo = await service.upload(
        bot.id,
        { buffer: png },
        BotImageKind.LOGO,
      );
      livePage({
        logo: logo.id,
        accent: '#F4A261',
        accentContrast: darkenForWhiteText('#F4A261'),
      });
      const available = await pageService.findAvailable('sunrise-mind');
      expect(available!.settings.branding.accentColour).toBe(
        darkenForWhiteText('#F4A261'),
      );
      expect(available!.settings.branding.logoUrl).toBe(
        `http://localhost:8001/api/v1/public/bot-images/sunrise-mind/${fileStem(images.rows[0])}-256.webp`,
      );
      expect(available!.brandImages.logo?.srcset).toContain('768w');
    });
  });
});
