import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GlobalSettingsRepository } from '../../settings/repository/global-settings.repository';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WHATSAPP_SETTINGS_NAME,
  WhatsAppBotSettings,
} from '../../whatsapp/type/whatsapp-settings.type';
import { Chatbot } from '../entity/chatbot.entity';
import type {
  ChatbotSettingsOverride,
  ChatbotSettingsView,
} from '../type/chatbot.type';
import { packFor } from '../../bot-draft/safety-pack/safety-packs';
import {
  SafetyLockedError,
  assertSettingsKeepPack,
} from '../../bot-draft/safety-pack/safety-lock';

/**
 * The defaults every chatbot inherits (the `whatsapp_bot` settings row) and each bot's changes on
 * top of them.
 */
@Injectable()
export class ChatbotSettingsService {
  private readonly logger = LoggerService.getInstance(
    ChatbotSettingsService.name,
  );

  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
  ) {}
  /**
   * Read the settings, filling any missing field from defaults.
   *
   * Merged per field, including the nested `rateLimit` and `retrieval` objects, rather than
   * "stored row OR defaults". A row written before a field existed would otherwise leave it
   * undefined, and an undefined threshold does not fall back — it disables the gate that depends
   * on it. A missing `declineSimilarity`, for instance, would silently stop the bot ever declining.
   */
  async get(): Promise<WhatsAppBotSettings> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name: WHATSAPP_SETTINGS_NAME },
    });
    return this.merge(row?.value as Partial<WhatsAppBotSettings> | undefined);
  }

  /**
   * The settings a message is answered with for one bot: the defaults, then the bot's changes on
   * top. `null` (no bot) is the defaults unchanged.
   */
  async getForChatbot(
    chatbot:
      | (Pick<Chatbot, 'settings'> & Partial<Pick<Chatbot, 'safetyPack'>>)
      | null,
  ): Promise<WhatsAppBotSettings> {
    const defaults = await this.get();
    return chatbot
      ? this.applyOverride(defaults, chatbot.settings, chatbot.safetyPack)
      : defaults;
  }

  /** Defaults, this bot's changes, and the result — what the settings screen shows. */
  async getChatbotView(
    chatbot: Pick<Chatbot, 'id' | 'settings'> &
      Partial<Pick<Chatbot, 'safetyPack'>>,
  ): Promise<ChatbotSettingsView> {
    const defaults = await this.get();
    const overrides = chatbot.settings ?? {};
    return {
      chatbotId: chatbot.id,
      defaults,
      overrides,
      effective: this.applyOverride(defaults, overrides, chatbot.safetyPack),
    };
  }

  /**
   * Replace one bot's changes. The whole set is sent each time, so "reset to default" is simply
   * leaving a field out; empty text is dropped for the same reason.
   */
  async updateChatbotSettings(
    chatbot: Pick<Chatbot, 'id'> & Partial<Pick<Chatbot, 'safetyPack'>>,
    overrides: ChatbotSettingsOverride,
  ): Promise<ChatbotSettingsView> {
    // A safety pack's settings can't be turned off (chunk 20a): refused, not silently floored, so
    // the editor knows why the switch didn't move.
    try {
      assertSettingsKeepPack(chatbot.safetyPack, overrides);
    } catch (error) {
      if (error instanceof SafetyLockedError) {
        throw new BadRequestException({
          errorCode: error.code,
          message: error.message,
          details: { reason: error.reason },
        });
      }
      throw error;
    }
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const settings = cleanOverride(overrides);
    await this.chatbotRepository.update(
      { id: chatbot.id },
      { settings, updatedBy: userId },
    );
    this.logger.info(`Chatbot ${chatbot.id} settings updated`);
    return this.getChatbotView({
      id: chatbot.id,
      settings,
      safetyPack: chatbot.safetyPack,
    });
  }

  /**
   * Merge a bot's changes over the defaults.
   *
   * Wording replaces the default. The safety and cost levers only TIGHTEN: a bot can turn on the
   * crisis classifier or consent, or lower its rate limits, but never weaken what the platform
   * set — a bot's settings screen must not be a way round the crisis safety net. `enabled` is the
   * same rule: a bot can be switched off, not on, against the platform switch.
   *
   * A bot with a safety pack (chunk 20a) also gets the pack's floor: a health pack keeps the crisis
   * classifier on even where the platform default has it off.
   */
  applyOverride(
    global: WhatsAppBotSettings,
    override: ChatbotSettingsOverride | undefined,
    safetyPack?: string | null,
  ): WhatsAppBotSettings {
    const floor = packFor(safetyPack)?.requiredSettings;
    if (floor?.crisisClassifierEnabled && !global.crisisClassifierEnabled) {
      global = { ...global, crisisClassifierEnabled: true };
    }
    if (!override || !Object.keys(override).length) return global;
    const { rateLimit, retrieval, ...plain } = override;
    const tighter = (base: number, value: number | undefined) =>
      typeof value === 'number' && value > 0 ? Math.min(base, value) : base;
    return {
      ...global,
      ...plain,
      enabled: global.enabled && override.enabled !== false,
      crisisClassifierEnabled:
        global.crisisClassifierEnabled ||
        override.crisisClassifierEnabled === true,
      consentRequired:
        global.consentRequired || override.consentRequired === true,
      // Platform-wide only. The per-bot settings body is not checked key by key, so a bot's jsonb
      // could otherwise switch the new engine on for itself past the kill switch.
      agentRuntimeAllowed: global.agentRuntimeAllowed,
      // The shared store's switches are platform-wide for the same reason.
      sharedStoreWrites: global.sharedStoreWrites,
      readHistoryFrom: global.readHistoryFrom,
      botPagePublicAllowed: global.botPagePublicAllowed,
      dashboardReadsFrom: global.dashboardReadsFrom,
      rateLimit: {
        perMinute: tighter(global.rateLimit.perMinute, rateLimit?.perMinute),
        perHour: tighter(global.rateLimit.perHour, rateLimit?.perHour),
        perDay: tighter(global.rateLimit.perDay, rateLimit?.perDay),
      },
      retrieval: { ...global.retrieval, ...(retrieval ?? {}) },
    };
  }

  private merge(
    stored: Partial<WhatsAppBotSettings> | undefined,
  ): WhatsAppBotSettings {
    return {
      ...DEFAULT_WHATSAPP_SETTINGS,
      ...(stored ?? {}),
      rateLimit: {
        ...DEFAULT_WHATSAPP_SETTINGS.rateLimit,
        ...(stored?.rateLimit ?? {}),
      },
      retrieval: {
        ...DEFAULT_WHATSAPP_SETTINGS.retrieval,
        ...(stored?.retrieval ?? {}),
      },
    };
  }

  /** Update settings, merging over what is stored so a partial save cannot blank a field. */
  async update(
    patch: Partial<WhatsAppBotSettings>,
  ): Promise<WhatsAppBotSettings> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: WHATSAPP_SETTINGS_NAME },
    });

    const merged = this.merge({
      ...((existing?.value as Partial<WhatsAppBotSettings>) ?? {}),
      ...patch,
      rateLimit: {
        ...((existing?.value as WhatsAppBotSettings)?.rateLimit ?? {}),
        ...(patch.rateLimit ?? {}),
      },
      retrieval: {
        ...((existing?.value as WhatsAppBotSettings)?.retrieval ?? {}),
        ...(patch.retrieval ?? {}),
      },
    });

    if (existing) {
      await this.globalSettingsRepository.update(
        { id: existing.id },
        // Cast: GlobalSettings.value is a loose Record<string, any> jsonb column, and TypeORM's
        // deep-partial type wants an index signature that a precise interface does not have.
        { value: merged as unknown as Record<string, any>, updatedBy: userId },
      );
    } else {
      await this.globalSettingsRepository.save(
        this.globalSettingsRepository.create({
          name: WHATSAPP_SETTINGS_NAME,
          value: merged,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }

    this.logger.info('WhatsApp bot settings updated');
    return merged;
  }

  /** Substitute the placeholders a template body may contain. */
  renderPlaceholders(text: string, settings: WhatsAppBotSettings): string {
    return text.replace(
      /\{helpline_numbers\}/g,
      settings.helplineNumbers || 'your local crisis line',
    );
  }
}

/**
 * Whether a settings write changes a key only a platform admin may set ("Show typing", which also
 * turns on read receipts). Leaving it as stored, or leaving it out when it was never set, is not a
 * change, so a bot editor's save round-trips it.
 */
export function changesAdminOnlySetting(
  stored: ChatbotSettingsOverride | null | undefined,
  next: ChatbotSettingsOverride | null | undefined,
): boolean {
  return (stored?.showTyping ?? null) !== (next?.showTyping ?? null);
}

/**
 * The platform settings only a platform admin may change (chunk 12b): opening bot pages to anyone,
 * and moving the dashboard onto the shared store. `PUT /v1/whatsapp/settings` is otherwise open to
 * anyone with the WhatsApp bot edit permission. A key left out, or sent unchanged, is not a change.
 */
export const PLATFORM_ADMIN_ONLY_SETTINGS = [
  'botPagePublicAllowed',
  'dashboardReadsFrom',
] as const;

export function changesPlatformAdminOnlySetting(
  stored: WhatsAppBotSettings,
  patch: Partial<Record<string, unknown>>,
): boolean {
  return PLATFORM_ADMIN_ONLY_SETTINGS.some(
    (key) => patch[key] !== undefined && patch[key] !== stored[key],
  );
}

/** Drop empty strings and unset values, so "cleared in the form" means "follow the default". */
export function cleanOverride(
  override: ChatbotSettingsOverride,
): ChatbotSettingsOverride {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (typeof value === 'object') {
      const nested = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([, v]) => v !== undefined && v !== null && v !== '',
        ),
      );
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out as ChatbotSettingsOverride;
}
