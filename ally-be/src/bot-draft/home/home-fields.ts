import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BotPageLimitsDto,
  PrechatFieldDto,
} from '../../chatbot/dto/bot-page.dto';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../../chatbot/enum/bot-page.enum';
import {
  BOT_PAGE_BOUNDS,
  BotPageLanguage,
  BotPageSettings,
  BotPageWidget,
  DEFAULT_WIDGET_LABEL,
} from '../../chatbot/type/bot-page.type';
import {
  MAX_WIDGET_DOMAINS,
  normaliseDomain,
} from '../../chatbot/bot-page/widget-host';
import {
  ChatbotAccessMode,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import {
  ChatbotSettingsOverride,
  MAX_SYSTEM_PROMPT_CHARS,
} from '../../chatbot/type/chatbot.type';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import { packFor } from '../safety-pack/safety-packs';

/**
 * The assistant home's fields (chunk 20d): each thing an owner edits once, mapped to every place it
 * is stored. Before this, the assistant's name lived in the persona and again in the page's
 * branding, and the disclaimer in the bot's settings and again on the page; a field here writes
 * both, so they can't drift apart.
 *
 * Each save carries the version of the value it was based on (a hash of that value). A save based
 * on a value that has since changed is refused with the current value, so two tabs never silently
 * overwrite each other; different fields never conflict.
 */

/** What a field reads from: the bot row and its page's settings (stored, over the defaults). */
export interface HomeState {
  chatbot: Pick<
    Chatbot,
    | 'name'
    | 'description'
    | 'persona'
    | 'settings'
    | 'safetyPack'
    | 'rules'
    | 'accessMode'
  >;
  page: BotPageSettings;
  /** The page row's own columns, and whether "Anyone with the link" may be chosen. */
  pageRow: { status: BotPageStatus; access: BotPageAccess };
  publicAllowed: boolean;
}

/** What a field writes: columns on the bot and keys of the page's settings. */
interface HomeWrite {
  chatbot?: Partial<
    Pick<
      Chatbot,
      'name' | 'description' | 'persona' | 'settings' | 'accessMode' | 'status'
    >
  >;
  page?: Partial<BotPageSettings>;
  pageRow?: Partial<HomeState['pageRow']>;
}

/** A value that can't be saved; the message is shown under the field. */
import {
  HANDOVER_LIMITS,
  handoverOf,
  type HandoverSettings,
  type OpeningHours,
} from '../../chatbot/handover/handover';

export class HomeFieldInvalid extends Error {}

interface HomeField<T> {
  read(state: HomeState): T;
  /** Clean and check a value sent by the client. */
  parse(value: unknown): T;
  write(value: T, state: HomeState): HomeWrite;
}

const text =
  (max: number, options: { required?: boolean; label: string }) =>
  (value: unknown): string => {
    if (typeof value !== 'string') {
      throw new HomeFieldInvalid(`${options.label} must be text.`);
    }
    const clean = value.trim();
    if (options.required && !clean) {
      throw new HomeFieldInvalid(`${options.label} can't be empty.`);
    }
    if (clean.length > max) {
      throw new HomeFieldInvalid(
        `${options.label} can be at most ${max} characters.`,
      );
    }
    return clean;
  };

/** A wording override: empty text means "use the default", so the key is dropped. */
function overrideText(
  key: keyof ChatbotSettingsOverride,
  max: number,
  label: string,
): HomeField<string> {
  return {
    read: (s) => String(s.chatbot.settings?.[key] ?? ''),
    parse: text(max, { label }),
    write: (value, s) => {
      const settings = { ...(s.chatbot.settings ?? {}) } as Record<
        string,
        unknown
      >;
      if (value) settings[key] = value;
      else delete settings[key];
      return { chatbot: { settings: settings as ChatbotSettingsOverride } };
    },
  };
}

function persona(
  key: 'displayName' | 'greeting' | 'tone' | 'systemPrompt',
  parse: (value: unknown) => string,
  alsoPage?: (value: string, s: HomeState) => Partial<BotPageSettings>,
): HomeField<string> {
  return {
    read: (s) => s.chatbot.persona?.[key] ?? '',
    parse,
    write: (value, s) => ({
      chatbot: { persona: { ...(s.chatbot.persona ?? {}), [key]: value } },
      ...(alsoPage ? { page: alsoPage(value, s) } : {}),
    }),
  };
}

function checkDto<T extends object>(cls: new () => T, value: unknown): T {
  const instance = plainToInstance(cls, value);
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    throw new HomeFieldInvalid(
      Object.values(errors[0].constraints ?? {})[0] ??
        `"${errors[0].property}" isn't valid.`,
    );
  }
  return instance;
}

export const HOME_FIELDS = {
  /** The business's name: the bot's name and the page's title. */
  name: {
    read: (s) => s.chatbot.name,
    parse: text(80, { required: true, label: 'The name' }),
    write: (value, s) => ({
      chatbot: { name: value },
      page: { branding: { ...s.page.branding, title: value } },
    }),
  } as HomeField<string>,

  assistantName: persona(
    'displayName',
    text(60, { required: true, label: "Your assistant's name" }),
    (value, s) => ({ branding: { ...s.page.branding, assistantName: value } }),
  ),

  introduction: persona('greeting', text(600, { label: 'The introduction' })),

  tone: persona('tone', text(60, { label: 'The tone' })),

  /** "Extra instructions": the safety rules always come first (the engine's fenced block). */
  instructions: persona(
    'systemPrompt',
    text(MAX_SYSTEM_PROMPT_CHARS, { label: 'Extra instructions' }),
  ),

  declineText: overrideText(
    'declineText',
    500,
    "What it says when it doesn't know",
  ),

  /** One disclaimer: the bot's settings and the page's first screen. A pack's must stay in it. */
  disclaimer: {
    read: (s) =>
      String(s.chatbot.settings?.disclaimerText ?? s.page.branding.disclaimer),
    parse: text(300, { label: 'The disclaimer' }),
    write: (value, s) => {
      const pack = packFor(s.chatbot.safetyPack);
      if (pack?.disclaimer && !value.includes(pack.disclaimer)) {
        throw new SafetyLockedError('disclaimer_removed');
      }
      const settings = { ...(s.chatbot.settings ?? {}) };
      if (value) settings.disclaimerText = value;
      else delete settings.disclaimerText;
      return {
        chatbot: { settings },
        page: { branding: { ...s.page.branding, disclaimer: value } },
      };
    },
  } as HomeField<string>,

  crisisText: overrideText(
    'crisisEscalationText',
    1000,
    'What it says when someone may be at risk',
  ),

  suggestedQuestions: {
    read: (s) => s.page.suggestedQuestions,
    parse: (value) => {
      if (!Array.isArray(value)) {
        throw new HomeFieldInvalid('Suggested questions must be a list.');
      }
      const clean = value
        .map((q) =>
          text(BOT_PAGE_BOUNDS.maxSuggestedChars, {
            label: 'A suggested question',
          })(q),
        )
        .filter(Boolean);
      if (clean.length > BOT_PAGE_BOUNDS.maxSuggested) {
        throw new HomeFieldInvalid(
          `Up to ${BOT_PAGE_BOUNDS.maxSuggested} suggested questions.`,
        );
      }
      return clean;
    },
    write: (value) => ({ page: { suggestedQuestions: value } }),
  } as HomeField<string[]>,

  /**
   * Topics the owner asked it not to talk about (chunk 20a-2): sent with the safety rules and
   * enforced by ally-ai's check. The owner's own list, so it can be changed either way.
   */
  avoidTopics: {
    read: (s) => s.chatbot.rules?.avoid ?? [],
    parse: (value) => {
      if (!Array.isArray(value)) {
        throw new HomeFieldInvalid('Topics to avoid must be a list.');
      }
      const clean = [
        ...new Set(
          value
            .map((topic) => text(80, { label: 'A topic' })(topic))
            .filter(Boolean),
        ),
      ];
      if (clean.length > 10) {
        throw new HomeFieldInvalid('Up to 10 topics.');
      }
      return clean;
    },
    write: (value, s) => ({
      chatbot: {
        rules: { never: s.chatbot.rules?.never ?? [], avoid: value },
      },
    }),
  } as HomeField<string[]>,

  /** Who can message on WhatsApp (chunk 20d-2): the bot's own access mode, which WhatsApp's checks read. */
  whatsappAccess: {
    read: (s) => s.chatbot.accessMode,
    parse: (value) => {
      const mode = Object.values(ChatbotAccessMode).find((m) => m === value);
      if (!mode) throw new HomeFieldInvalid('Choose who can use it.');
      return mode;
    },
    write: (value) => ({ chatbot: { accessMode: value } }),
  } as HomeField<ChatbotAccessMode>,

  /** Questions before the chat: the page only (WhatsApp doesn't ask them). */
  prechat: {
    read: (s) => s.page.prechat,
    parse: (value) => {
      if (!Array.isArray(value)) {
        throw new HomeFieldInvalid('Questions before the chat must be a list.');
      }
      if (value.length > BOT_PAGE_BOUNDS.maxPrechat) {
        throw new HomeFieldInvalid(
          `Up to ${BOT_PAGE_BOUNDS.maxPrechat} questions before the chat.`,
        );
      }
      const ids = new Set<string>();
      return value.map((raw) => {
        const field = checkDto(PrechatFieldDto, raw);
        if (ids.has(field.id)) {
          throw new HomeFieldInvalid('Two questions share an id.');
        }
        ids.add(field.id);
        if (
          field.type === PrechatFieldType.CHOICE &&
          !(field.options ?? []).some((o) => o.trim())
        ) {
          throw new HomeFieldInvalid('A choice question needs its options.');
        }
        if (
          field.type === PrechatFieldType.CONSENT &&
          !field.consentText?.trim()
        ) {
          throw new HomeFieldInvalid('A consent question needs its wording.');
        }
        return {
          id: field.id,
          label: field.label.trim(),
          type: field.type,
          required:
            field.type === PrechatFieldType.CONSENT ? true : field.required,
          ...(field.type === PrechatFieldType.CHOICE
            ? {
                options: (field.options ?? [])
                  .map((o) => o.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(field.type === PrechatFieldType.CONSENT
            ? { consentText: field.consentText!.trim() }
            : {}),
        };
      });
    },
    write: (value) => ({ page: { prechat: value } }),
  } as HomeField<BotPageSettings['prechat']>,

  pageLimits: {
    read: (s) => s.page.limits,
    parse: (value) => {
      const limits = checkDto(BotPageLimitsDto, value);
      return {
        messagesPerVisitorPerHour: limits.messagesPerVisitorPerHour,
        maxMessageChars: limits.maxMessageChars,
        dailyCapPerBot: limits.dailyCapPerBot,
      };
    },
    write: (value) => ({ page: { limits: value } }),
  } as HomeField<BotPageSettings['limits']>,

  language: {
    read: (s) => s.page.language,
    parse: (value) => {
      if (value !== 'en' && value !== 'hi' && value !== 'auto') {
        throw new HomeFieldInvalid('Choose a language.');
      }
      return value as BotPageLanguage;
    },
    write: (value) => ({ page: { language: value } }),
  } as HomeField<BotPageLanguage>,

  /**
   * The page on or off. One switch with the assistant's own: on is live (people can use it), off
   * is paused, so "Live" never means a page nobody can open.
   */
  pageStatus: {
    read: (s) => s.pageRow.status,
    parse: (value) => {
      if (value !== BotPageStatus.ON && value !== BotPageStatus.OFF) {
        throw new HomeFieldInvalid('Choose on or off.');
      }
      return value as BotPageStatus;
    },
    write: (value) => ({
      pageRow: { status: value },
      chatbot: {
        status:
          value === BotPageStatus.ON
            ? ChatbotStatus.LIVE
            : ChatbotStatus.PAUSED,
      },
    }),
  } as HomeField<BotPageStatus>,

  /** Who can open the page. Public only while the platform allows it (12b). */
  pageAccess: {
    read: (s) => s.pageRow.access,
    parse: (value) => {
      if (!Object.values(BotPageAccess).includes(value as BotPageAccess)) {
        throw new HomeFieldInvalid('Choose who can use it.');
      }
      return value as BotPageAccess;
    },
    write: (value, s) => {
      if (value === BotPageAccess.PUBLIC && !s.publicAllowed) {
        throw new HomeFieldInvalid(
          'Public links are turned off for now. Choose organisation or specific people.',
        );
      }
      return { pageRow: { access: value } };
    },
  } as HomeField<BotPageAccess>,

  /** A person stepping in (chunk 11a): what visitors are told, the auto hand-back, the email. */
  handover: {
    read: (s) => handoverOf(s.chatbot.settings ?? {}),
    parse: (value) => parseHandover(value),
    write: (value, s) => ({
      chatbot: {
        settings: {
          ...(s.chatbot.settings ?? {}),
          handover: value,
        } as ChatbotSettingsOverride,
      },
    }),
  } as HomeField<HandoverSettings>,

  /** The website widget (chunk 13): the bubble's look and timing, and where it may appear. */
  widget: {
    read: (s) => s.page.widget,
    parse: (value) => parseWidget(value),
    write: (value) => ({ page: { widget: value } }),
  } as HomeField<BotPageWidget>,

  busyText: overrideText(
    'rateLimitText',
    500,
    'What it says when someone sends too many messages',
  ),

  /** WhatsApp messages (the "On WhatsApp" card). */
  unknownNumberText: overrideText(
    'unrecognisedNumberText',
    500,
    "What it says to a number it doesn't know",
  ),
  unsupportedMediaText: overrideText(
    'unsupportedMediaText',
    500,
    "What it says when it can't read a message",
  ),
};

export type HomeFieldName = keyof typeof HOME_FIELDS;

/** The widget's settings, checked. Domains are normalised, and refused with a reason the owner reads. */
export function parseWidget(
  value: unknown,
  production = process.env.NODE_ENV === 'production',
): BotPageWidget {
  if (!value || typeof value !== 'object') {
    throw new HomeFieldInvalid('Choose how the bubble looks.');
  }
  const v = value as Record<string, unknown>;
  if (v.position !== 'right' && v.position !== 'left') {
    throw new HomeFieldInvalid('Choose right or left.');
  }
  const label =
    text(BOT_PAGE_BOUNDS.maxWidgetLabelChars, { label: 'The bubble label' })(
      v.label ?? '',
    ) || DEFAULT_WIDGET_LABEL;
  let autoOpenSeconds: number | null = null;
  if (v.autoOpenSeconds !== null && v.autoOpenSeconds !== undefined) {
    const n = Number(v.autoOpenSeconds);
    if (
      !Number.isInteger(n) ||
      n < BOT_PAGE_BOUNDS.minWidgetAutoOpenSeconds ||
      n > BOT_PAGE_BOUNDS.maxWidgetAutoOpenSeconds
    ) {
      throw new HomeFieldInvalid(
        `Choose between ${BOT_PAGE_BOUNDS.minWidgetAutoOpenSeconds} and ${BOT_PAGE_BOUNDS.maxWidgetAutoOpenSeconds} seconds.`,
      );
    }
    autoOpenSeconds = n;
  }
  if (!Array.isArray(v.allowedDomains)) {
    throw new HomeFieldInvalid('Add your website addresses as a list.');
  }
  const domains: string[] = [];
  for (const entry of v.allowedDomains) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const checked = normaliseDomain(entry, { production });
    if ('refused' in checked) {
      throw new HomeFieldInvalid(domainRefusal(checked.refused, entry.trim()));
    }
    if (!domains.includes(checked.domain)) domains.push(checked.domain);
  }
  if (domains.length > MAX_WIDGET_DOMAINS) {
    throw new HomeFieldInvalid(
      `You can add up to ${MAX_WIDGET_DOMAINS} websites.`,
    );
  }
  return {
    position: v.position,
    label,
    autoOpenSeconds,
    showOnPhones: v.showOnPhones !== false,
    allowedDomains: domains,
  };
}

/** Why a website can't be added, in the owner's words (ONBOARDING-COPY.md §22). */
function domainRefusal(
  reason: 'invalid' | 'shared' | 'local',
  input: string,
): string {
  switch (reason) {
    case 'shared':
      return `${input} is shared by many websites, so the bubble could appear on sites that aren't yours. Add your own address on it, for example yourclinic.${input.replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/.*$/, '')}.`;
    case 'local':
      return 'localhost only works while testing. Add your real website address.';
    default:
      return `${input} isn't a website address. Add your domain, for example yourclinic.in.`;
  }
}

export function homeField(name: string): HomeField<unknown> | null {
  return Object.prototype.hasOwnProperty.call(HOME_FIELDS, name)
    ? (HOME_FIELDS[name as HomeFieldName] as unknown as HomeField<unknown>)
    : null;
}

/** A value's version: a short hash of it, keys sorted so storage order never matters. */
export function versionOf(value: unknown): string {
  return createHash('sha256')
    .update(stableJson(value ?? null))
    .digest('hex')
    .slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Every field's value and version, for the home's first load. */
export function readAll(
  state: HomeState,
): Record<HomeFieldName, { value: unknown; version: string }> {
  const out = {} as Record<HomeFieldName, { value: unknown; version: string }>;
  for (const name of Object.keys(HOME_FIELDS) as HomeFieldName[]) {
    const value = (HOME_FIELDS[name] as HomeField<unknown>).read(state);
    out[name] = { value, version: versionOf(value) };
  }
  return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The hand-over settings as the owner sent them, checked (chunk 11a). */
function parseHandover(value: unknown): HandoverSettings {
  const v = (value ?? {}) as Partial<HandoverSettings>;
  const replyWithin = String(v.replyWithin ?? '').trim();
  if (!replyWithin || replyWithin.length > HANDOVER_LIMITS.replyWithinChars) {
    throw new HomeFieldInvalid(
      `Say how soon the team usually replies, in up to ${HANDOVER_LIMITS.replyWithinChars} characters.`,
    );
  }
  const whole = (
    n: unknown,
    { min, max }: { min: number; max: number },
    what: string,
  ) => {
    const x = Number(n);
    if (!Number.isInteger(x) || x < min || x > max) {
      throw new HomeFieldInvalid(`${what} must be between ${min} and ${max}.`);
    }
    return x;
  };
  let hours: OpeningHours | null = null;
  if (v.hours) {
    const h = v.hours;
    const days = [...new Set((h.days ?? []).map(Number))].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    if (
      !days.length ||
      !HHMM.test(h.from) ||
      !HHMM.test(h.to) ||
      h.from >= h.to
    ) {
      throw new HomeFieldInvalid(
        'Opening hours need days, and a start before the end.',
      );
    }
    hours = {
      timeZone: h.timeZone || 'Asia/Kolkata',
      days: days.sort(),
      from: h.from,
      to: h.to,
    };
  }
  return {
    replyWithin,
    hours,
    autoHandBackHours: whole(
      v.autoHandBackHours,
      HANDOVER_LIMITS.autoHandBackHours,
      'Hours before it hands back',
    ),
    emailAfterMinutes: whole(
      v.emailAfterMinutes,
      HANDOVER_LIMITS.emailAfterMinutes,
      'Minutes before the email',
    ),
    showFirstName: v.showFirstName !== false,
  };
}
