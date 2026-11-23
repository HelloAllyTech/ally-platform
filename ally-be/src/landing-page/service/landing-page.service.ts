import { isDeepStrictEqual } from 'util';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { S3Service } from 'src/aws/service/s3.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import isDuplicateKeyException, {
  NotFoundException,
} from 'src/exception/custom.exception';
import { slugify } from 'src/blog/util/slug.util';
import { LoggerService } from 'src/logger/logger.service';
import { Tenant, TenantStatus } from 'src/tenant/entity/tenant.entity';
import { resolveBranding } from 'src/tenant/util/tenant-branding.util';

import {
  LANDING_IMAGE_MAX_SIZE_BYTES,
  LANDING_IMAGE_S3_PREFIX,
  LANDING_RESERVED_TENANT_CODES,
} from '../constants/landing-page.constants';
import {
  CreateLandingPageDto,
  GetLandingPagesQueryDto,
  GetLandingPagesResponseDto,
  LandingPageResponseDto,
  PublicLandingPageResponseDto,
  UpdateLandingPageDto,
  UploadLandingImageRequestDto,
  UploadLandingImageResponseDto,
} from '../dto/landing-page.dto';
import { LandingPage } from '../entity/landing-page.entity';
import { LandingPageStatus } from '../enum/landing-page-status.enum';
import {
  defaultLandingPageConfig,
  landingPagePublishProblems,
  normaliseLandingPageConfig,
} from '../util/landing-page-config.util';

const DEFAULT_PAGE_SIZE = 20;
const SLUG_INDEX = 'uq_landing_pages_tenant_slug_idx';

@Injectable()
export class LandingPageService {
  private readonly logger = LoggerService.getInstance(LandingPageService.name);

  constructor(
    @InjectRepository(LandingPage)
    private readonly pages: Repository<LandingPage>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
  ) {}

  // ---- helpers -------------------------------------------------------------

  private getUserId(): number {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('unauthorized access');
    return Number(userId);
  }

  private getBucket(): string {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new InternalServerErrorException(
        'S3 bucket name for assetsBucket is not defined',
      );
    }
    return bucket;
  }

  private imageHost(): string {
    return `${this.getBucket()}.s3.${this.configService.aws.region}.amazonaws.com`;
  }

  /** Only addresses we handed out through the upload endpoint may be stored. */
  private isAllowedImageUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        parsed.hostname === this.imageHost() &&
        parsed.pathname.startsWith(`/${LANDING_IMAGE_S3_PREFIX}/`)
      );
    } catch {
      return false;
    }
  };

  private normalise(raw: unknown) {
    return normaliseLandingPageConfig(raw, {
      isAllowedImageUrl: this.isAllowedImageUrl,
    });
  }

  private toResponse(
    page: LandingPage,
    tenant: Tenant,
  ): LandingPageResponseDto {
    return {
      id: page.id,
      tenantId: page.tenantId,
      tenantName: tenant.name,
      tenantCode: tenant.code,
      name: page.name,
      slug: page.slug,
      status: page.status,
      path: `/${tenant.code}/${page.slug}`,
      config: page.config,
      publishedConfig: page.publishedConfig ?? null,
      hasUnpublishedChanges:
        page.status === LandingPageStatus.PUBLISHED &&
        !isDeepStrictEqual(page.config, page.publishedConfig),
      publishedAt: page.publishedAt ?? null,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };
  }

  private async getActiveTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Organization not found');
    return tenant;
  }

  private async getPage(id: string): Promise<LandingPage> {
    const page = await this.pages.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Landing page not found');
    return page;
  }

  private rethrowSlugClash(error: unknown): never {
    if (isDuplicateKeyException(error, SLUG_INDEX)) {
      throw new ConflictException(
        'This organization already has a landing page with that address',
      );
    }
    throw error;
  }

  // ---- admin ---------------------------------------------------------------

  /** The blank page the create form asks for: its languages and sign-up switch. */
  private startingConfig(dto: CreateLandingPageDto) {
    const config = defaultLandingPageConfig();
    const languages = Array.from(new Set(dto.languages));
    config.languages = {
      enabled: languages,
      default:
        dto.defaultLanguage && languages.includes(dto.defaultLanguage)
          ? dto.defaultLanguage
          : languages[0],
    };
    config.signUp = { enabled: dto.signUpEnabled ?? false };
    return config;
  }

  async create(dto: CreateLandingPageDto): Promise<LandingPageResponseDto> {
    const userId = this.getUserId();
    const tenant = await this.getActiveTenant(dto.tenantId);
    if (LANDING_RESERVED_TENANT_CODES.includes(tenant.code.toLowerCase())) {
      throw new BadRequestException(
        `The organization code "${tenant.code}" is also an address the app already uses, so a landing page cannot live under it`,
      );
    }
    const slug = dto.slug ?? slugify(dto.name).slice(0, 60);
    if (!slug) {
      throw new BadRequestException('Give the page a name or an address');
    }

    try {
      const saved = await this.pages.save(
        this.pages.create({
          tenantId: tenant.id,
          name: dto.name.trim(),
          slug,
          status: LandingPageStatus.DRAFT,
          config: this.startingConfig(dto),
          publishedConfig: null,
          publishedAt: null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
      return this.toResponse(saved, tenant);
    } catch (error) {
      return this.rethrowSlugClash(error);
    }
  }

  async list(
    query: GetLandingPagesQueryDto,
  ): Promise<GetLandingPagesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const builder = this.pages
      .createQueryBuilder('lp')
      .innerJoinAndSelect('lp.tenant', 'tenant')
      .orderBy('lp.updatedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.tenantId) {
      builder.andWhere('lp.tenantId = :tenantId', { tenantId: query.tenantId });
    }
    if (query.status) {
      builder.andWhere('lp.status = :status', { status: query.status });
    }
    if (query.search?.trim()) {
      builder.andWhere('(lp.name ILIKE :search OR lp.slug ILIKE :search)', {
        search: `%${query.search.trim()}%`,
      });
    }

    const [rows, total] = await builder.getManyAndCount();
    return {
      items: rows.map((row) => this.toResponse(row, row.tenant as Tenant)),
      total,
      page,
      limit,
    };
  }

  async getById(id: string): Promise<LandingPageResponseDto> {
    const page = await this.getPage(id);
    return this.toResponse(page, await this.getActiveTenant(page.tenantId));
  }

  async update(
    id: string,
    dto: UpdateLandingPageDto,
  ): Promise<LandingPageResponseDto> {
    const userId = this.getUserId();
    const page = await this.getPage(id);
    const tenant = await this.getActiveTenant(page.tenantId);

    if (dto.name !== undefined) page.name = dto.name.trim();
    if (dto.slug !== undefined) page.slug = dto.slug;
    if (dto.config !== undefined) page.config = this.normalise(dto.config);
    page.updatedBy = userId;

    try {
      return this.toResponse(await this.pages.save(page), tenant);
    } catch (error) {
      return this.rethrowSlugClash(error);
    }
  }

  async remove(id: string): Promise<void> {
    const userId = this.getUserId();
    const page = await this.getPage(id);
    page.updatedBy = userId;
    await this.pages.save(page);
    await this.pages.softDelete({ id });
  }

  async publish(id: string): Promise<LandingPageResponseDto> {
    const userId = this.getUserId();
    const page = await this.getPage(id);
    const tenant = await this.getActiveTenant(page.tenantId);
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new BadRequestException(
        'The organization is not active, so its pages cannot go live',
      );
    }

    const problems = landingPagePublishProblems(page.config);
    if (problems.length > 0) {
      throw new BadRequestException({
        message: 'This page is not ready to publish',
        problems,
      });
    }

    page.status = LandingPageStatus.PUBLISHED;
    page.publishedConfig = page.config;
    page.publishedAt = new Date();
    page.updatedBy = userId;
    return this.toResponse(await this.pages.save(page), tenant);
  }

  async unpublish(id: string): Promise<LandingPageResponseDto> {
    const userId = this.getUserId();
    const page = await this.getPage(id);
    const tenant = await this.getActiveTenant(page.tenantId);
    page.status = LandingPageStatus.DRAFT;
    page.publishedConfig = null;
    page.publishedAt = null;
    page.updatedBy = userId;
    return this.toResponse(await this.pages.save(page), tenant);
  }

  /** The draft, rendered the way visitors will see it once published. */
  async getPreview(id: string): Promise<PublicLandingPageResponseDto> {
    const page = await this.getPage(id);
    const tenant = await this.getActiveTenant(page.tenantId);
    return {
      name: page.name,
      slug: page.slug,
      tenantCode: tenant.code,
      config: page.config,
      branding: { ...resolveBranding(tenant, tenant.settings?.branding) },
    };
  }

  async createImageUploadUrl(
    dto: UploadLandingImageRequestDto,
  ): Promise<UploadLandingImageResponseDto> {
    if (dto.fileSize > LANDING_IMAGE_MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `File size must be ${LANDING_IMAGE_MAX_SIZE_BYTES / (1024 * 1024)} MB or less`,
      );
    }
    await this.getActiveTenant(dto.tenantId);

    const bucket = this.getBucket();
    const safeName = this.s3Service.sanitizeFileName(dto.fileName);
    const key = `${LANDING_IMAGE_S3_PREFIX}/${dto.tenantId}/${uuidv4()}-${safeName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key,
      operation: 'put',
      expiresIn: 600,
      contentType: dto.contentType,
    });
    return { presignedUrl, imageUrl: `https://${this.imageHost()}/${key}` };
  }

  // ---- public --------------------------------------------------------------

  async getPublished(
    tenantCode: string,
    slug: string,
  ): Promise<PublicLandingPageResponseDto> {
    const tenant = await this.tenants.findOne({ where: { code: tenantCode } });
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new NotFoundException('Landing page not found');
    }
    const page = await this.pages.findOne({
      where: {
        tenantId: tenant.id,
        slug,
        status: LandingPageStatus.PUBLISHED,
      },
    });
    if (!page?.publishedConfig) {
      throw new NotFoundException('Landing page not found');
    }
    return {
      name: page.name,
      slug: page.slug,
      tenantCode: tenant.code,
      config: page.publishedConfig,
      branding: { ...resolveBranding(tenant, tenant.settings?.branding) },
    };
  }
}
