import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CHATBOT_ACTIVITY,
  type ChatbotActivityEvent,
} from '../type/chatbot-activity';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
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
  loosensSafetySetting,
  validateSafetySettings,
} from '../safety/safety-settings';
import { ABILITY_VALUES } from '../agent-tools/tools';
import { validateHumanContact } from '../safety/safety-terms';
import {
  NOTICE_MEANING_REFUSED,
  noticeKeepsMeaning,
} from '../safety/chat-notice';
import {
  SafetyLockedError,
  assertSettingsKeepPack,
} from '../../bot-draft/safety-pack/safety-lock';

/**
 * The defaults every chatbot inherits (the `whatsapp_bot` settings row) and each bot's changes on
 * top of them.
 */
import {
  crisisHelplines,
  helplineLines,
  ownerHelplineFields,
} from '../engine/crisis-helplines';

import { voiceText } from '../voice/voice-text';

/** COPY: needs approval (TF1 round 2, S-1). */
export const HELPLINE_NO_NUMBER =
  'Add the phone number crisis replies should give, like +91 20 4860 2525. Put opening hours in your notes instead.';

@Injectable()
export class ChatbotSettingsService {
  private readonly logger = LoggerService.getInstance(
    ChatbotSettingsService.name,
  );

  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    // TF1 round 2: the owner confirming the helpline numbers, for the assistant's History.
    @Optional() private readonly emitter?: EventEmitter2,
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
    if (!chatbot) return defaults;
    const effective = this.applyOverride(
      defaults,
      chatbot.settings,
      chatbot.safetyPack,
    );
    // TF1 round 2 (Saathi B-1): an assistant never inherits the staff number's decline ("My
    // reference material does not cover that. A colleague or supervisor…"). Without the owner's
    // own wording it gets its voice's, else the neutral default. The fixed decline picks the
    // person's language at send time (`withDeclineContact`).
    if (!chatbot.settings?.declineText?.trim()) {
      effective.declineText = voiceText(chatbot.settings, 'decline', 'en');
    }
    // Nor its start notice's "answers from our reference material": with no wording of the
    // owner's own, the fixed "You are chatting with an AI assistant…" line is the whole notice.
    if (!chatbot.settings?.disclaimerText?.trim()) {
      effective.disclaimerText = '';
    }
    // TF1 round 2 (Sahyog N-1): nor the staff number's helpline ("Tele-MANAS 14416", stored with
    // no source, so it read as owner-confirmed). An assistant's own line is only ever its owner's;
    // without one, crisis replies carry the pack's national numbers as themselves.
    effective.helplineNumbers = chatbot.settings?.helplineNumbers ?? '';
    effective.helplineSource = chatbot.settings?.helplineSource ?? null;
    effective.helplineConfirmedAt =
      chatbot.settings?.helplineConfirmedAt ?? null;
    return effective;
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
    chatbot: Pick<Chatbot, 'id'> &
      Partial<Pick<Chatbot, 'safetyPack' | 'settings'>>,
    overrides: ChatbotSettingsOverride,
    options: { byOwner?: boolean } = {},
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
    // What the agent may do (chunk 3b): only the values the gateway knows.
    const abilities = overrides?.abilities;
    if (
      abilities !== undefined &&
      (typeof abilities !== 'object' ||
        abilities === null ||
        Array.isArray(abilities) ||
        Object.values(abilities).some(
          (value) => !(ABILITY_VALUES as readonly unknown[]).includes(value),
        ))
    ) {
      throw new BadRequestException(
        `abilities maps each tool to one of: ${ABILITY_VALUES.join(', ')}`,
      );
    }
    const invalid =
      validateSafetySettings(overrides) ??
      validateHumanContact(
        (overrides as { humanContact?: unknown })?.humanContact,
      );
    if (invalid) throw new BadRequestException(invalid);
    // Stage 4: a changed start notice must keep "an AI and people may read this chat". Wording
    // stored before the rule is left alone until it is changed.
    const disclaimer = overrides?.disclaimerText?.trim();
    if (disclaimer && !noticeKeepsMeaning(disclaimer)) {
      const stored = await this.chatbotRepository
        .findOne({ where: { id: chatbot.id }, select: ['id', 'settings'] })
        .catch(() => null);
      if ((stored?.settings?.disclaimerText ?? '').trim() !== disclaimer) {
        throw new BadRequestException({
          errorCode: 'notice_meaning',
          message: NOTICE_MEANING_REFUSED,
          details: { field: 'disclaimerText' },
        });
      }
    }
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    // Q4 G7: whose the helpline is. Only the owner's own save can make it theirs (a changed number,
    // or "Use this number in crisis replies"); a client never sets the source itself.
    const { helplineConfirm, ...rest } = overrides ?? {};
    // TF1 round 2, S-1: only the numbers are stored, so what Settings shows is what a crisis reply
    // says. Text with no number at all is refused rather than saved and silently dropped.
    if (typeof rest.helplineNumbers === 'string') {
      const typed = rest.helplineNumbers.trim();
      const numbers = helplineLines(typed);
      // A screen sends every stored key back: only a value the owner changed is refused.
      const changed =
        typed !== (chatbot.settings?.helplineNumbers ?? '').trim();
      if (typed && !numbers && changed) {
        throw new BadRequestException({
          errorCode: 'helpline_no_number',
          message: HELPLINE_NO_NUMBER,
          details: { field: 'helplineNumbers' },
        });
      }
      rest.helplineNumbers = numbers;
    }
    const helpline = options.byOwner
      ? ownerHelplineFields(
          chatbot.settings,
          { helplineNumbers: rest.helplineNumbers, helplineConfirm },
          new Date(),
        )
      : {};
    // Q4 B11 ("Change entries: Do it" didn't stick): what a settings screen doesn't edit (the
    // list abilities, memory, the time zone) keeps its stored value when the screen leaves it out,
    // so saving General can't put back a copy loaded before the list wizard changed it.
    const kept = options.byOwner
      ? Object.fromEntries(
          (['abilities', 'memory', 'timeZone'] as const)
            .filter((k) => rest[k] === undefined && chatbot.settings?.[k])
            .map((k) => [k, chatbot.settings![k]]),
        )
      : {};
    const settings = cleanOverride({ ...kept, ...rest, ...helpline });
    await this.chatbotRepository.update(
      { id: chatbot.id },
      { settings, updatedBy: userId },
    );
    this.logger.info(`Chatbot ${chatbot.id} settings updated`);
    const confirmedAt = (helpline as { helplineConfirmedAt?: string | null })
      .helplineConfirmedAt;
    if (confirmedAt && confirmedAt !== chatbot.settings?.helplineConfirmedAt) {
      this.emitter?.emit(CHATBOT_ACTIVITY, {
        chatbotId: chatbot.id,
        field: 'helpline',
        before: chatbot.settings?.helplineNumbers ?? null,
        after: settings.helplineNumbers ?? null,
        userId: userId || null,
      } satisfies ChatbotActivityEvent);
    }
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
    // `abilities` stays on the bot's stored override, where the gateway reads it (chunk 3b), and so
    // do `memory` (chunk 8a) and `timeZone` (chunk 6b).
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      rateLimit,
      retrieval,
      abilities,
      memory,
      timeZone,
      audienceAge,
      retentionDays,
      noAnswerMode,
      enabledLanguages,
      alertPolicy,
      waitBeforeNoOneAvailableMinutes,
      crisisResumeRule,
      archivedMessage,
      // Stage 6: per-user dollar limits, read by the credits gate from the stored override.
      userLimits,
      // Stage 4: read from the stored override by the go-live gate.
      humanContact,
      ...plain
    } = override;
    /* eslint-enable @typescript-eslint/no-unused-vars */
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
      // The shared store's switches are platform-wide only: the per-bot settings body is not
      // checked key by key, so a bot's jsonb could otherwise switch them on for itself.
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
    // Per bot only (chunk 3b): a platform-wide value would turn a tool on for every bot, for
    // anyone who can edit the WhatsApp settings. Nothing reads it from here anyway.
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'abilities')) {
      throw new BadRequestException(
        "abilities is set per assistant, in that assistant's settings",
      );
    }
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
      // Q4 G7: only numbers the owner confirmed.
      crisisHelplines(settings) || DEFAULT_HELPLINE_PLACEHOLDER,
    );
  }
}

/**
 * What `{helpline_numbers}` becomes when the bot has none (R6): the findahelpline.com link, never
 * a country's numbers and never the vague "your local crisis line".
 */
export const DEFAULT_HELPLINE_PLACEHOLDER =
  'a helpline listed at https://findahelpline.com';

/**
 * Whether a settings write changes a key only the bot's owners may set (A1; platform admins before):
 * "Show typing" (which also turns on read receipts), and what the agent may do (`abilities`, chunk
 * 3b, `hand_over` included). Leaving it as stored,
 * or leaving it out when it was never set, is not a change, so a bot editor's save round-trips it.
 */
export function changesAdminOnlySetting(
  stored: ChatbotSettingsOverride | null | undefined,
  next: ChatbotSettingsOverride | null | undefined,
): boolean {
  return (
    (stored?.showTyping ?? null) !== (next?.showTyping ?? null) ||
    stableJson(stored?.abilities) !== stableJson(next?.abilities) ||
    // Loosening a safety setting (adults-only, longer retention, digest alerts…) is the owner's.
    loosensSafetySetting(stored, next)
  );
}

/** JSON with keys sorted, so `{a, b}` and `{b, a}` compare equal; null for unset or empty. */
function stableJson(
  value: Record<string, unknown> | null | undefined,
): string | null {
  if (!value || !Object.keys(value).length) return null;
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

/**
 * The platform settings only a platform admin may change (chunk 12b): opening bot pages to anyone,
 * and moving the dashboard onto the shared store. `PUT /v1/whatsapp/settings` is otherwise open to
 * anyone with the WhatsApp bot edit permission. A key left out, or sent unchanged, is not a change.
 */
const PLATFORM_ADMIN_ONLY_SETTINGS = [
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
    if (Array.isArray(value)) {
      // Lists (enabledLanguages) stay lists; an empty one means "follow the default".
      if (value.length) out[key] = value;
      continue;
    }
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
