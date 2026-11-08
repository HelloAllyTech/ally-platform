import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Raw, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../aws/service/s3.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AppConfigService } from '../../config/config.service';
import { darkenForWhiteText } from '../../tenant/util/brand-colour.util';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import { BotImage, BotImageStatus } from '../bot-image/bot-image.entity';
import { PublicImage, publicImage } from '../bot-image/urls';
import { UpdateBotPageBrandDto } from '../dto/bot-image.dto';
import { BotPageLogoUrlDto, UpdateBotPageDto } from '../dto/bot-page.dto';
import { ChatbotPage } from '../entity/chatbot-page.entity';
import { Chatbot } from '../entity/chatbot.entity';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../enum/bot-page.enum';
import { ChatbotStatus } from '../enum/chatbot.enum';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import {
  BotPageBrand,
  BotPageSettings,
  brandImageIds,
  defaultBotPageSettings,
  mergeBotPageSettings,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  slugFromName,
} from '../type/bot-page.type';

/** What the Bot page tab reads: the page (or its defaults) and the platform rules around it. */
export interface BotPageView {
  /** False until the page is first saved. */
  saved: boolean;
  status: BotPageStatus;
  slug: string;
  access: BotPageAccess;
  settings: BotPageSettings;
  link: string;
  /** Whether "Anyone with the link" can be chosen (the platform's `botPagePublicAllowed`). */
  publicAllowed: boolean;
  /** Whether the page answers right now, and why not. */
  live: {
    ok: boolean;
    reason?: 'page_off' | 'bot_not_live' | 'public_blocked' | 'platform_off';
  };
  /** "Daily cap reached today", from the rate limiter. Filled by the controller. */
  dailyCapReached?: boolean;
}

/** A page a visitor may reach: on, its bot live, and public only while the platform allows it. */
export interface AvailableBotPage {
  page: ChatbotPage;
  chatbot: Chatbot;
  /** With `branding.logoUrl` and `branding.accentColour` taken from `brand` where it sets them. */
  settings: BotPageSettings;
  botSettings: WhatsAppBotSettings;
  /** The brand's images on the public image route, by role. */
  brandImages: {
    logo: PublicImage | null;
    cover: PublicImage | null;
    share: PublicImage | null;
  };
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class BotPageService {
  constructor(
    @InjectRepository(ChatbotPage)
    private readonly pageRepository: Repository<ChatbotPage>,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    private readonly settingsService: ChatbotSettingsService,
    private readonly s3: S3Service,
    private readonly config: AppConfigService,
    // Last and optional so specs written before chunk 20d construct the service unchanged; Nest
    // always provides it.
    @Optional()
    @InjectRepository(BotImage)
    private readonly imageRepository?: Repository<BotImage>,
  ) {}

  link(slug: string): string {
    return `${this.config.botPage.baseUrl}/b/${slug}`;
  }

  findForChatbot(chatbotId: string): Promise<ChatbotPage | null> {
    return this.pageRepository.findOne({ where: { chatbotId } });
  }

  async view(chatbot: Chatbot): Promise<BotPageView> {
    const [page, botSettings] = await Promise.all([
      this.findForChatbot(chatbot.id),
      this.settingsService.getForChatbot(chatbot),
    ]);
    const settings = mergeBotPageSettings(
      this.defaults(chatbot, botSettings),
      page?.settings,
    );
    const slug = page?.slug ?? (await this.suggestSlug(chatbot));
    const access = page?.access ?? BotPageAccess.INVITE;
    const status = page?.status ?? BotPageStatus.OFF;
    return {
      saved: Boolean(page),
      status,
      slug,
      access,
      settings,
      link: this.link(slug),
      publicAllowed: botSettings.botPagePublicAllowed,
      live: BotPageService.liveness({ status, access }, chatbot, botSettings),
    };
  }

  /** Create or replace the page. Public needs the platform's permission; slugs are unique. */
  async save(chatbot: Chatbot, dto: UpdateBotPageDto): Promise<BotPageView> {
    const slug = BotPageService.checkSlug(dto.slug);
    const botSettings = await this.settingsService.getForChatbot(chatbot);
    if (
      dto.access === BotPageAccess.PUBLIC &&
      !botSettings.botPagePublicAllowed
    ) {
      throw new BadRequestException(
        'Public links are turned off for now. Choose organisation or specific people.',
      );
    }
    BotPageService.checkPrechat(dto.settings.prechat);
    if (!(await this.slugAvailable(slug, chatbot.id))) {
      throw new ConflictException(`The link "${slug}" is already taken.`);
    }

    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;
    const existing = await this.findForChatbot(chatbot.id);
    // The look is changed only through `saveBrand`: a brand sent here is ignored and the stored one
    // kept, so the Bot page tab and onboarding's publish can't drop or forge it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { brand: _ignored, ...incoming } =
      dto.settings as UpdateBotPageDto['settings'] & {
        brand?: unknown;
      };
    const settings = {
      ...incoming,
      ...(existing?.settings?.brand ? { brand: existing.settings.brand } : {}),
      branding: {
        ...dto.settings.branding,
        logoUrl: dto.settings.branding.logoUrl || null,
        avatarUrl: dto.settings.branding.avatarUrl || null,
        footerLink: dto.settings.branding.footerLink ?? null,
      },
      suggestedQuestions: dto.settings.suggestedQuestions.map((q) => q.trim()),
      prechat: dto.settings.prechat.map((field) => ({
        id: field.id,
        label: field.label.trim(),
        type: field.type,
        required:
          field.type === PrechatFieldType.CONSENT ? true : field.required,
        ...(field.type === PrechatFieldType.CHOICE
          ? { options: (field.options ?? []).map((o) => o.trim()) }
          : {}),
        ...(field.type === PrechatFieldType.CONSENT
          ? { consentText: field.consentText!.trim() }
          : {}),
      })),
    } as BotPageSettings;
    try {
      await this.pageRepository.save({
        ...(existing ?? {}),
        chatbotId: chatbot.id,
        slug,
        status: dto.status,
        access: dto.access,
        settings,
        createdBy: existing?.createdBy ?? userId,
        updatedBy: userId,
      });
    } catch (error) {
      // The unique index decides a race between two saves of the same slug.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(`The link "${slug}" is already taken.`);
      }
      throw error;
    }
    return this.view(chatbot);
  }

  /**
   * Change the page's look (chunk 20d): only the fields sent. Image ids must be this bot's attached
   * images; the accent's contrast-corrected copy is computed here. Before the page's first save
   * (onboarding's "Make it yours"), this creates it, off, with its suggested link.
   */
  async saveBrand(
    chatbot: Chatbot,
    dto: UpdateBotPageBrandDto,
  ): Promise<BotPageView> {
    const existing = await this.findForChatbot(chatbot.id);
    const botSettings = await this.settingsService.getForChatbot(chatbot);
    const current = mergeBotPageSettings(
      this.defaults(chatbot, botSettings),
      existing?.settings,
    ).brand;
    const next: BotPageBrand = {
      ...current,
      ...(dto.logo !== undefined ? { logo: dto.logo } : {}),
      ...(dto.coverImage !== undefined ? { coverImage: dto.coverImage } : {}),
      ...(dto.shareImage !== undefined ? { shareImage: dto.shareImage } : {}),
      ...(dto.headingStyle ? { headingStyle: dto.headingStyle } : {}),
      ...(dto.theme ? { theme: dto.theme } : {}),
      ...(dto.peoplePhotos ? { peoplePhotos: dto.peoplePhotos } : {}),
      landingImages: {
        hero:
          dto.landingImages?.hero !== undefined
            ? dto.landingImages.hero
            : current.landingImages.hero,
        gallery: dto.landingImages?.gallery ?? current.landingImages.gallery,
      },
    };
    if (dto.accent !== undefined) {
      next.accent = dto.accent ? dto.accent.toUpperCase() : null;
      next.accentContrast = dto.accent ? darkenForWhiteText(dto.accent) : null;
    }
    const people = Object.entries(next.peoplePhotos);
    if (
      people.length > 50 ||
      people.some(
        ([name, id]) =>
          !name.trim() || name.length > 120 || typeof id !== 'string',
      )
    ) {
      throw new BadRequestException('Team photos need a name and an image.');
    }
    const ids = [...new Set(brandImageIds(next))];
    if (ids.length) {
      const found = await this.imageRepository!.count({
        where: {
          chatbotId: chatbot.id,
          id: In(ids),
          status: BotImageStatus.ATTACHED,
        },
      });
      if (found !== ids.length) {
        throw new BadRequestException(
          'That image is no longer on this assistant.',
        );
      }
    }

    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;
    if (existing) {
      await this.pageRepository.save({
        ...existing,
        settings: { ...existing.settings, brand: next },
        updatedBy: userId,
      });
    } else {
      await this.pageRepository.save({
        chatbotId: chatbot.id,
        slug: await this.suggestSlug(chatbot),
        status: BotPageStatus.OFF,
        access: BotPageAccess.INVITE,
        settings: { brand: next } as BotPageSettings,
        createdBy: userId,
        updatedBy: userId,
      });
    }
    return this.view(chatbot);
  }

  async slugAvailable(slug: string, chatbotId?: string): Promise<boolean> {
    const taken = await this.pageRepository.findOne({
      where: {
        slug: Raw((alias) => `lower(${alias}) = lower(:slug)`, { slug }),
      },
    });
    return !taken || taken.chatbotId === chatbotId;
  }

  async logoUploadUrl(
    chatbotId: string,
    dto: BotPageLogoUrlDto,
  ): Promise<{ presignedUrl: string; imageUrl: string }> {
    const bucket = this.config.s3.assetsBucket;
    if (!bucket) {
      throw new BadRequestException(
        'Logo uploads are not set up here. Paste a link instead.',
      );
    }
    if (!LOGO_TYPES.includes(dto.contentType)) {
      throw new BadRequestException('Use a PNG, JPEG or WebP image.');
    }
    return this.s3.getPresignedUrlForImageUpload(
      bucket,
      `bot-page-logos/${chatbotId}-${uuidv4()}`,
      dto.fileName,
      dto.fileSize,
      dto.contentType,
      LOGO_MAX_BYTES,
    );
  }

  /**
   * The page at `slug`, if a visitor may reach it now; otherwise null, and the caller answers 404
   * whatever the reason, so a link that is off, draft or blocked looks the same as one that never
   * existed.
   */
  async findAvailable(slug: string): Promise<AvailableBotPage | null> {
    if (!SLUG_PATTERN.test(slug.toLowerCase())) return null;
    const page = await this.pageRepository.findOne({
      where: {
        slug: Raw((alias) => `lower(${alias}) = lower(:slug)`, { slug }),
      },
    });
    if (!page) return null;
    const chatbot = await this.chatbotRepository.findOne({
      where: { id: page.chatbotId, archivedAt: IsNull() },
    });
    if (!chatbot) return null;
    const botSettings = await this.settingsService.getForChatbot(chatbot);
    if (!BotPageService.liveness(page, chatbot, botSettings).ok) return null;
    const settings = mergeBotPageSettings(
      this.defaults(chatbot, botSettings),
      page.settings,
    );
    const brandImages = await this.resolveBrand(
      page.slug,
      chatbot.id,
      settings,
    );
    return { page, chatbot, botSettings, settings, brandImages };
  }

  /**
   * The brand as visitors get it: image ids become URLs on the public image route (only attached
   * images; a removed one is simply absent), and `branding.logoUrl` and `branding.accentColour`
   * follow the brand where it sets them, so the OTP email and older clients match the page.
   */
  private async resolveBrand(
    slug: string,
    chatbotId: string,
    settings: BotPageSettings,
  ): Promise<AvailableBotPage['brandImages']> {
    const brand = settings.brand;
    const none = { logo: null, cover: null, share: null };
    if (brand.accentContrast)
      settings.branding.accentColour = brand.accentContrast;
    const ids = [brand.logo, brand.coverImage, brand.shareImage].filter(
      (id): id is string => Boolean(id),
    );
    if (!ids.length || !this.imageRepository) return none;
    const rows = await this.imageRepository.find({
      where: { chatbotId, id: In(ids), status: BotImageStatus.ATTACHED },
    });
    const base = this.config.publicApiBaseUrl;
    const pick = (id: string | null, size: 256 | 768 | 1600) => {
      const row = id ? rows.find((r) => r.id === id) : undefined;
      return row ? publicImage(base, slug, row, size) : null;
    };
    const resolved = {
      logo: pick(brand.logo, 256),
      cover: pick(brand.coverImage, 1600),
      share: pick(brand.shareImage, 1600),
    };
    if (resolved.logo) settings.branding.logoUrl = resolved.logo.src;
    return resolved;
  }

  static liveness(
    page: Pick<ChatbotPage, 'status' | 'access'>,
    chatbot: Pick<Chatbot, 'status'>,
    botSettings: Pick<WhatsAppBotSettings, 'enabled' | 'botPagePublicAllowed'>,
  ): BotPageView['live'] {
    if (page.status !== BotPageStatus.ON)
      return { ok: false, reason: 'page_off' };
    if (chatbot.status !== ChatbotStatus.LIVE)
      return { ok: false, reason: 'bot_not_live' };
    if (!botSettings.enabled) return { ok: false, reason: 'platform_off' };
    if (
      page.access === BotPageAccess.PUBLIC &&
      !botSettings.botPagePublicAllowed
    ) {
      return { ok: false, reason: 'public_blocked' };
    }
    return { ok: true };
  }

  static checkSlug(raw: string): string {
    const slug = (raw ?? '').trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      throw new BadRequestException(
        'A link uses 3–48 lower-case letters, digits and single hyphens, starting and ending with a letter or digit.',
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(
        `"${slug}" is reserved. Choose another link.`,
      );
    }
    return slug;
  }

  static checkPrechat(fields: UpdateBotPageDto['settings']['prechat']): void {
    const ids = new Set<string>();
    for (const field of fields) {
      if (ids.has(field.id)) {
        throw new BadRequestException('Two pre-chat questions share an id.');
      }
      ids.add(field.id);
      if (field.type === PrechatFieldType.CHOICE) {
        const options = (field.options ?? [])
          .map((o) => o.trim())
          .filter(Boolean);
        if (options.length < 2) {
          throw new BadRequestException(
            `"${field.label}" needs at least two choices.`,
          );
        }
        if (new Set(options).size !== options.length) {
          throw new BadRequestException(
            `"${field.label}" lists the same choice twice.`,
          );
        }
      }
      if (
        field.type === PrechatFieldType.CONSENT &&
        !field.consentText?.trim()
      ) {
        throw new BadRequestException(
          `"${field.label}" needs the wording people agree to.`,
        );
      }
    }
  }

  private defaults(chatbot: Chatbot, botSettings: WhatsAppBotSettings) {
    return defaultBotPageSettings({
      name: chatbot.name,
      persona: chatbot.persona,
      crisisSafetyOn: botSettings.crisisClassifierEnabled,
    });
  }

  /** The bot's name as a slug, with a number added until it is free. */
  async suggestSlug(chatbot: Chatbot): Promise<string> {
    const base = slugFromName(chatbot.name);
    const candidate = RESERVED_SLUGS.has(base) ? `${base}-chat` : base;
    for (let n = 0; n < 20; n++) {
      const slug = n ? `${candidate.slice(0, 44)}-${n + 1}` : candidate;
      if (await this.slugAvailable(slug, chatbot.id)) return slug;
    }
    return `${candidate.slice(0, 39)}-${uuidv4().slice(0, 8)}`;
  }
}
