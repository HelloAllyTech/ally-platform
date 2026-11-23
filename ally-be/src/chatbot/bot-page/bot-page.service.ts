import { offReasonOf, type OffReason } from '../safety/off-message';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { prechatFor } from './prechat-minors';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Raw, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../../aws/service/s3.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AppConfigService } from '../../config/config.service';
import { darkenForWhiteText } from '../../tenant/util/brand-colour.util';
import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';
import { BotImage, BotImageStatus } from '../entity/bot-image.entity';
import { PublicImage, publicImage } from '../bot-image/urls';
import {
  RETIRED_BRAND_FIELDS,
  UpdateBotPageBrandDto,
} from '../dto/bot-image.dto';
import { BotPageLogoUrlDto, UpdateBotPageDto } from '../dto/bot-page.dto';
import { ChatbotPage } from '../entity/chatbot-page.entity';
import {
  ChatbotDomain,
  ChatbotDomainStatus,
} from '../entity/chatbot-domain.entity';
import { Chatbot } from '../entity/chatbot.entity';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../enum/bot-page.enum';
import { ChatbotStatus } from '../enum/chatbot.enum';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import {
  BOT_PAGE_BOUNDS,
  BotPageBrand,
  BotPageBranding,
  BotPageSettings,
  DEFAULT_BOT_PAGE_LIMITS,
  defaultBotPageSettings,
  mergeBotPageSettings,
  PUBLIC_ID_PATTERN,
  randomPublicId,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  slugFromName,
} from '../type/bot-page.type';

/** What the Bot page tab reads: the page (or its defaults) and the platform rules around it. */
export interface BotPageView {
  /** False until the page is first saved. */
  saved: boolean;
  status: BotPageStatus;
  /** The legacy link's key; kept for older clients. Never shown or editable (stage 7). */
  slug: string;
  /** The page's address key (`/chat/<publicId>`), assigned by Ally. Null until the first save. */
  publicId: string | null;
  access: BotPageAccess;
  settings: BotPageSettings;
  /** `<chatUrl>/<publicId>`; empty until the page is first saved (it has no address yet). */
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
    // Stage 7: verified custom domains resolve to their page. Optional for older test wiring.
    @Optional()
    @InjectRepository(ChatbotDomain)
    private readonly domainRepository?: Repository<ChatbotDomain>,
  ) {}

  /** The page's address (stage 7): `<chatUrl>/<publicId>`, never the owner-chosen slug. */
  link(publicId: string): string {
    return `${this.config.botPage.chatUrl}/${publicId}`;
  }

  /**
   * A fresh address: random, and equal to no page's public id or legacy slug, so `/chat/<id>` and
   * `/b/<slug>` can never name two pages.
   */
  async newPublicId(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomPublicId();
      const taken = await this.pageRepository.findOne({
        where: [
          { publicId: candidate },
          {
            slug: Raw((alias) => `lower(${alias}) = :candidate`, { candidate }),
          },
        ],
      });
      if (!taken) return candidate;
    }
    throw new ConflictException('Could not assign an address. Try again.');
  }

  /**
   * The page a public key names (stage 7): its address (`public_id`), its legacy slug (old
   * `/b/<slug>` links and widget embeds), or a verified custom domain's host. Null when none.
   */
  async findByKey(raw: string): Promise<ChatbotPage | null> {
    const key = (raw ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!key || key.length > 253) return null;
    if (key.includes('.')) {
      if (!this.domainRepository) return null;
      const domain = await this.domainRepository.findOne({
        where: {
          host: Raw((alias) => `lower(${alias}) = :key`, { key }),
          status: ChatbotDomainStatus.VERIFIED,
        },
      });
      return domain ? this.findForChatbot(domain.chatbotId) : null;
    }
    if (PUBLIC_ID_PATTERN.test(key)) {
      const page = await this.pageRepository.findOne({
        where: { publicId: key },
      });
      if (page) return page;
    }
    if (!SLUG_PATTERN.test(key)) return null;
    return this.pageRepository.findOne({
      where: {
        slug: Raw((alias) => `lower(${alias}) = lower(:key)`, { key }),
      },
    });
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
    const publicId = page?.publicId ?? null;
    return {
      saved: Boolean(page),
      status,
      slug,
      publicId,
      access,
      settings,
      link: publicId ? this.link(publicId) : '',
      publicAllowed: botSettings.botPagePublicAllowed,
      live: BotPageService.liveness({ status, access }, chatbot, botSettings),
    };
  }

  /**
   * Create or replace the page. Public needs the platform's permission.
   *
   * Stage 7: the address is Ally's (`publicId`, set on the first save) and `dto.slug` is ignored:
   * the stored legacy slug never changes. The look's retired words (subtitle, avatar, disclaimer,
   * footer link) are ignored too and the stored values kept, inert; only the name, the welcome
   * line and the colour and logo through `saveBrand` change how the page looks. Pre-chat questions
   * stay functional: without `prechat` in the body the stored ones are kept.
   */
  async save(chatbot: Chatbot, dto: UpdateBotPageDto): Promise<BotPageView> {
    const botSettings = await this.settingsService.getForChatbot(chatbot);
    if (
      dto.access === BotPageAccess.PUBLIC &&
      !botSettings.botPagePublicAllowed
    ) {
      throw new BadRequestException(
        'Public links are turned off for now. Choose organisation or specific people.',
      );
    }
    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;
    const existing = await this.findForChatbot(chatbot.id);
    const prechatIn = dto.settings.prechat ?? existing?.settings?.prechat ?? [];
    BotPageService.checkPrechat(prechatIn);
    const slug = existing?.slug ?? (await this.suggestSlug(chatbot));
    const publicId = existing?.publicId ?? (await this.newPublicId());
    const defaults = this.defaults(chatbot, botSettings).branding;
    const storedBranding: Partial<BotPageBranding> =
      existing?.settings?.branding ?? {};
    const retired = (
      key: 'subtitle' | 'avatarUrl' | 'disclaimer' | 'footerLink',
    ) => (key in storedBranding ? storedBranding[key] : defaults[key]);
    // The look is changed only through `saveBrand`, and the website widget (chunk 13) only through
    // its home field: either sent here is ignored and the stored one kept, so the Bot page tab and
    // onboarding's publish can't drop or forge them.
    const incoming = { ...dto.settings } as UpdateBotPageDto['settings'] & {
      brand?: unknown;
      widget?: unknown;
    };
    delete incoming.brand;
    delete incoming.widget;
    const settings = {
      ...incoming,
      ...(existing?.settings?.brand ? { brand: existing.settings.brand } : {}),
      ...(existing?.settings?.widget
        ? { widget: existing.settings.widget }
        : {}),
      branding: {
        logoUrl: dto.settings.branding.logoUrl || null,
        accentColour: dto.settings.branding.accentColour,
        title: dto.settings.branding.title,
        assistantName: dto.settings.branding.assistantName,
        subtitle: retired('subtitle'),
        avatarUrl: retired('avatarUrl'),
        disclaimer: retired('disclaimer'),
        footerLink: retired('footerLink'),
        welcome: (dto.settings.branding.welcome ?? storedBranding.welcome ?? '')
          .trim()
          .slice(0, BOT_PAGE_BOUNDS.maxWelcomeChars),
      },
      suggestedQuestions: dto.settings.suggestedQuestions.map((q) => q.trim()),
      limits: {
        ...DEFAULT_BOT_PAGE_LIMITS,
        ...(existing?.settings?.limits ?? {}),
        ...dto.settings.limits,
      },
      prechat: prechatIn.map((field) => ({
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
        publicId,
        status: dto.status,
        access: dto.access,
        settings,
        createdBy: existing?.createdBy ?? userId,
        updatedBy: userId,
      });
    } catch (error) {
      // The unique indexes decide a race between two first saves.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'The page changed at the same time. Try again.',
        );
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
    BotPageService.rejectRetiredLook(dto);
    const existing = await this.findForChatbot(chatbot.id);
    const botSettings = await this.settingsService.getForChatbot(chatbot);
    const current = mergeBotPageSettings(
      this.defaults(chatbot, botSettings),
      existing?.settings,
    ).brand;
    // Stage 7: only the logo and the accent change here; the retired look fields keep their stored
    // values, inert.
    const next: BotPageBrand = {
      ...current,
      ...(dto.logo !== undefined ? { logo: dto.logo } : {}),
    };
    if (dto.accent !== undefined) {
      next.accent = dto.accent ? dto.accent.toUpperCase() : null;
      next.accentContrast = dto.accent ? darkenForWhiteText(dto.accent) : null;
    }
    const welcome =
      dto.welcome !== undefined
        ? dto.welcome.trim().slice(0, BOT_PAGE_BOUNDS.maxWelcomeChars)
        : undefined;
    // Only a newly chosen logo is checked: stored images that were removed since stay inert.
    const ids = dto.logo ? [dto.logo] : [];
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
        settings: {
          ...existing.settings,
          brand: next,
          ...(welcome !== undefined
            ? {
                branding: {
                  ...(existing.settings?.branding ?? {}),
                  welcome,
                } as BotPageBranding,
              }
            : {}),
        },
        updatedBy: userId,
      });
    } else {
      await this.pageRepository.save({
        chatbotId: chatbot.id,
        slug: await this.suggestSlug(chatbot),
        publicId: await this.newPublicId(),
        status: BotPageStatus.OFF,
        access: BotPageAccess.INVITE,
        settings: {
          brand: next,
          ...(welcome !== undefined
            ? { branding: { welcome } as BotPageBranding }
            : {}),
        } as BotPageSettings,
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
  /**
   * Stage 4: the chatbot behind a page that is archived or paused (by its team or the go-live gate),
   * so the page can show its off message with the crisis information instead of "not found".
   */
  async findOff(
    key: string,
  ): Promise<{ chatbot: Chatbot; reason: OffReason } | null> {
    const page = await this.findByKey(key);
    if (!page) return null;
    const chatbot = await this.chatbotRepository.findOne({
      where: { id: page.chatbotId },
    });
    const reason = chatbot ? offReasonOf(chatbot) : null;
    return chatbot && reason ? { chatbot, reason } : null;
  }

  /** `key`: the page's address, its legacy slug, or a verified custom domain (`findByKey`). */
  async findAvailable(key: string): Promise<AvailableBotPage | null> {
    const page = await this.findByKey(key);
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
    // Young people (Q3-fast Part 1): no name or contact questions before the chat.
    settings.prechat = prechatFor(settings.prechat, chatbot.safetyPack);
    const brandImages = await this.resolveBrand(
      page.publicId ?? page.slug,
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
    key: string,
    chatbotId: string,
    settings: BotPageSettings,
  ): Promise<AvailableBotPage['brandImages']> {
    const brand = settings.brand;
    const none = { logo: null, cover: null, share: null };
    if (brand.accentContrast)
      settings.branding.accentColour = brand.accentContrast;
    // Stage 7: the logo is the only image a page shows; a stored cover or share image is inert.
    const ids = [brand.logo].filter((id): id is string => Boolean(id));
    if (!ids.length || !this.imageRepository) return none;
    const rows = await this.imageRepository.find({
      where: { chatbotId, id: In(ids), status: BotImageStatus.ATTACHED },
    });
    const base = this.config.publicApiBaseUrl;
    const pick = (id: string | null, size: 256 | 768 | 1600) => {
      const row = id ? rows.find((r) => r.id === id) : undefined;
      return row ? publicImage(base, key, row, size) : null;
    };
    const resolved = { logo: pick(brand.logo, 256), cover: null, share: null };
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

  /** Stage 7: a look change that sends a retired field is refused, never half-applied. */
  static rejectRetiredLook(dto: object): void {
    const sent = RETIRED_BRAND_FIELDS.filter((key) => key in (dto ?? {}));
    if (sent.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'look_field_retired',
        message: `These can no longer be changed: ${sent.join(', ')}. The page shows its name, logo, one colour and a welcome line.`,
        fields: sent,
      });
    }
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
