import { BadRequestException, ConflictException } from '@nestjs/common';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { NotFoundException } from 'src/exception/custom.exception';
import { TenantStatus } from 'src/tenant/entity/tenant.entity';

import { LandingPageStatus } from '../enum/landing-page-status.enum';
import { LandingPageService } from '../service/landing-page.service';
import { defaultLandingPageConfig } from '../util/landing-page-config.util';

const BUCKET = 'assets';
const REGION = 'eu-test-1';
const HOST = `${BUCKET}.s3.${REGION}.amazonaws.com`;

const tenant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Agatsu Foundation',
  code: 'agatsu',
  status: TenantStatus.ACTIVE,
  logoUrl: 'https://cdn.example.com/agatsu.png',
  settings: {},
};

const readyConfig = () => {
  const config = defaultLandingPageConfig();
  config.headings.first = { en: 'Baat Se Baat Banegi' };
  config.helpline.text = { en: 'Call [number]' };
  config.footer.disclaimer.text = { en: 'Not an emergency service' };
  for (const card of config.cards.items) card.title = { en: card.key };
  return config;
};

const makePage = (overrides: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: tenant.id,
  name: 'Campaign',
  slug: 'campaign',
  status: LandingPageStatus.DRAFT,
  config: readyConfig(),
  publishedConfig: null,
  publishedAt: null,
  createdAt: new Date('2026-11-20'),
  updatedAt: new Date('2026-11-20'),
  ...overrides,
});

describe('LandingPageService', () => {
  let pages: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
  };
  let tenants: { findOne: jest.Mock };
  let s3: { sanitizeFileName: jest.Mock; generatePresignedUrl: jest.Mock };
  let service: LandingPageService;

  beforeEach(() => {
    pages = {
      findOne: jest.fn(),
      save: jest.fn(async (page) => page),
      create: jest.fn((value) => ({ ...value })),
      softDelete: jest.fn(),
    };
    tenants = { findOne: jest.fn().mockResolvedValue({ ...tenant }) };
    s3 = {
      sanitizeFileName: jest.fn((name) => name),
      generatePresignedUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example.com/put'),
    };
    const config = { s3: { assetsBucket: BUCKET }, aws: { region: REGION } };
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(7 as never);
    service = new LandingPageService(
      pages as never,
      tenants as never,
      s3 as never,
      config as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    const dto = {
      tenantId: tenant.id,
      name: 'Baat Se Baat Banegi',
      languages: ['en', 'hi'] as never,
    };

    it('makes a draft with the chosen languages, sign-up setting and an address built from the name', async () => {
      const result = await service.create({
        ...dto,
        signUpEnabled: true,
      } as never);
      expect(result.slug).toBe('baat-se-baat-banegi');
      expect(result.path).toBe('/agatsu/baat-se-baat-banegi');
      expect(result.status).toBe(LandingPageStatus.DRAFT);
      expect(result.config.languages).toEqual({
        enabled: ['en', 'hi'],
        default: 'en',
      });
      expect(result.config.signUp.enabled).toBe(true);
      expect(result.config.template).toBe('standard');
      expect(result.publishedConfig).toBeNull();
    });

    it('honours a chosen default language that is one of the languages', async () => {
      const result = await service.create({
        ...dto,
        defaultLanguage: 'hi',
      } as never);
      expect(result.config.languages.default).toBe('hi');
    });

    it('ignores a default language the page does not offer', async () => {
      const result = await service.create({
        ...dto,
        defaultLanguage: 'ta',
      } as never);
      expect(result.config.languages.default).toBe('en');
    });

    it('refuses an organization whose code is an address the app already uses', async () => {
      tenants.findOne.mockResolvedValue({ ...tenant, code: 'Blog' });
      await expect(service.create(dto as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pages.save).not.toHaveBeenCalled();
    });

    it('reports an address already taken in that organization', async () => {
      pages.save.mockRejectedValue({
        name: 'QueryFailedError',
        code: '23505',
        constraint: 'uq_landing_pages_tenant_slug_idx',
      });
      await expect(service.create(dto as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not guess when the organization is unknown', async () => {
      tenants.findOne.mockResolvedValue(null);
      await expect(service.create(dto as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('cleans the config it is given and refuses an image from elsewhere', async () => {
      pages.findOne.mockResolvedValue(makePage());
      await expect(
        service.update('p', {
          config: { hero: { imageUrl: 'https://evil.example.com/a.png' } },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pages.save).not.toHaveBeenCalled();
    });

    it('stores a cleaned config', async () => {
      pages.findOne.mockResolvedValue(makePage());
      const result = await service.update('p', {
        config: { template: 'split', headings: { first: { en: '  Hello  ' } } },
      });
      expect(result.config.template).toBe('split');
      expect(result.config.headings.first).toEqual({ en: 'Hello' });
    });
  });

  describe('publish and unpublish', () => {
    it('copies the draft to the live copy', async () => {
      const page = makePage();
      pages.findOne.mockResolvedValue(page);
      const result = await service.publish(page.id);
      expect(result.status).toBe(LandingPageStatus.PUBLISHED);
      expect(result.publishedConfig).toEqual(page.config);
      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(result.hasUnpublishedChanges).toBe(false);
    });

    it('lists what is missing instead of publishing an unfinished page', async () => {
      pages.findOne.mockResolvedValue(
        makePage({ config: defaultLandingPageConfig() }),
      );
      const failure = await service.publish('p').catch((error) => error);
      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.getResponse().problems).toContain(
        'The first heading is empty in en.',
      );
      expect(pages.save).not.toHaveBeenCalled();
    });

    it('will not publish for an inactive organization', async () => {
      pages.findOne.mockResolvedValue(makePage());
      tenants.findOne.mockResolvedValue({
        ...tenant,
        status: TenantStatus.SUSPENDED,
      });
      await expect(service.publish('p')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('shows unpublished changes once the draft moves on from the live copy', async () => {
      const live = readyConfig();
      const draft = { ...readyConfig(), template: 'focus' as const };
      pages.findOne.mockResolvedValue(
        makePage({
          status: LandingPageStatus.PUBLISHED,
          config: draft,
          publishedConfig: live,
        }),
      );
      expect((await service.getById('p')).hasUnpublishedChanges).toBe(true);
    });

    it('takes a page down but keeps the draft', async () => {
      const page = makePage({
        status: LandingPageStatus.PUBLISHED,
        publishedConfig: readyConfig(),
        publishedAt: new Date(),
      });
      pages.findOne.mockResolvedValue(page);
      const result = await service.unpublish(page.id);
      expect(result.status).toBe(LandingPageStatus.DRAFT);
      expect(result.publishedConfig).toBeNull();
      expect(result.publishedAt).toBeNull();
      expect(result.config).toEqual(page.config);
    });
  });

  describe('public read', () => {
    const published = () =>
      makePage({
        status: LandingPageStatus.PUBLISHED,
        publishedConfig: { ...readyConfig(), template: 'focus' as const },
        config: { ...readyConfig(), template: 'split' as const },
      });

    it('serves the live copy, never the draft, with the organization branding', async () => {
      pages.findOne.mockResolvedValue(published());
      const result = await service.getPublished('agatsu', 'campaign');
      expect(result.config.template).toBe('focus');
      expect(result.tenantCode).toBe('agatsu');
      expect(result.branding).toMatchObject({ logoUrl: tenant.logoUrl });
      expect(pages.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: tenant.id,
          slug: 'campaign',
          status: LandingPageStatus.PUBLISHED,
        },
      });
    });

    it('says not found for an unknown or inactive organization', async () => {
      tenants.findOne.mockResolvedValue(null);
      await expect(
        service.getPublished('nobody', 'campaign'),
      ).rejects.toBeInstanceOf(NotFoundException);
      tenants.findOne.mockResolvedValue({
        ...tenant,
        status: TenantStatus.INACTIVE,
      });
      await expect(
        service.getPublished('agatsu', 'campaign'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('says not found when there is no live page', async () => {
      pages.findOne.mockResolvedValue(null);
      await expect(
        service.getPublished('agatsu', 'campaign'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('preview', () => {
    it('returns the draft in the public shape', async () => {
      pages.findOne.mockResolvedValue(
        makePage({ config: { ...readyConfig(), template: 'split' } }),
      );
      const result = await service.getPreview('p');
      expect(result.config.template).toBe('split');
      expect(result.tenantCode).toBe('agatsu');
    });
  });

  describe('createImageUploadUrl', () => {
    const request = {
      fileName: 'hero.png',
      contentType: 'image/png' as never,
      fileSize: 1024,
      tenantId: tenant.id,
    };

    it('hands out a signed upload and the address to store, in our own storage', async () => {
      const result = await service.createImageUploadUrl(request);
      expect(result.presignedUrl).toBe('https://signed.example.com/put');
      expect(
        result.imageUrl.startsWith(
          `https://${HOST}/landing-pages/${tenant.id}/`,
        ),
      ).toBe(true);
      expect(s3.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: BUCKET,
          operation: 'put',
          contentType: 'image/png',
        }),
      );
    });

    it('stores the address it handed out: a config that uses it is accepted', async () => {
      const { imageUrl } = await service.createImageUploadUrl(request);
      pages.findOne.mockResolvedValue(makePage());
      const result = await service.update('p', {
        config: { hero: { enabled: true, imageUrl } },
      });
      expect(result.config.hero.imageUrl).toBe(imageUrl);
    });

    it('refuses a file that is too large', async () => {
      await expect(
        service.createImageUploadUrl({
          ...request,
          fileSize: 50 * 1024 * 1024,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.generatePresignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes', async () => {
      pages.findOne.mockResolvedValue(makePage());
      await service.remove('p');
      expect(pages.softDelete).toHaveBeenCalledWith({ id: 'p' });
    });

    it('says not found for a page that does not exist', async () => {
      pages.findOne.mockResolvedValue(null);
      await expect(service.remove('p')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
