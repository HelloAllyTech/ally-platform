import { usageContext } from 'src/billing/context/usage-context';
import { withFirstMessageParts } from '../engine/first-reply';
import { startNotice } from '../safety/chat-notice';
import { offMessage } from '../safety/off-message';
import { ActionsService } from '../actions/actions.service';
import {
  ActionPartsService,
  type ReplyParts,
} from '../actions/action-parts.service';
import { replyLanguageOf } from '../engine/reply-language';
import { UsageChannel, UsageKind } from 'src/billing/enum/billing.enum';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { ErrorCode } from '../../exception/error-code.enum';
import { LoggerService } from '../../logger/logger.service';
import { WaUnansweredQuestion } from '../../whatsapp/entity/wa-unanswered-question.entity';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';
import {
  BotPageEmbedDto,
  BotPageFeedbackDto,
  BotPageIntakeDto,
  BotPageSessionDto,
  BotPageVerifyDto,
} from '../dto/bot-page.dto';
import { isFailedRun } from '../engine/agent-runtime';
import { crisisHelplines } from '../engine/crisis-helplines';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import type {
  ChatbotDecision,
  ChatChannel,
  LiveReply,
} from '../engine/chatbot-engine.types';
import { ChatbotContact } from '../entity/chatbot-contact.entity';
import { ChatbotConversation } from '../entity/chatbot-conversation.entity';
import { BotPageAccess } from '../enum/bot-page.enum';
import { AgentRuntimeUsed, ChatbotAccessMode } from '../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import { ConversationService } from '../service/conversation.service';
import {
  AGENT_FALLBACK_EVENT,
  AgentFallbackEvent,
} from '../type/agent-runtime.event';
import {
  BOT_PAGE_BOUNDS,
  DEFAULT_BOT_PAGE_LIMITS,
  PrechatField,
} from '../type/bot-page.type';
import {
  BotPageAccessService,
  BotPageEligibility,
} from './bot-page-access.service';
import {
  IntakeError,
  intakeName,
  intakeRequired,
  StoredIntake,
  validateIntake,
} from './bot-page-intake';
import { BotPageOtpService } from './bot-page-otp.service';
import {
  BOT_PAGE_IP_LIMITS,
  BotPageRateLimitService,
} from './bot-page-rate-limit.service';
import { AvailableBotPage, BotPageService } from './bot-page.service';
import {
  BotPageVisitor,
  BotPageVisitorService,
  IssuedVisitor,
} from './bot-page-visitor.service';
import { cleanPageUrl } from './widget-host';
import { WidgetSitesService, widgetSiteHost } from './widget-sites.service';
import { SseWriter } from '../../common/sse/sse-writer';
import { handoverMessage, handoverOf } from '../handover/handover';
import { HandoverService } from '../handover/handover.service';
import { InboxEventsService } from '../inbox/inbox-events.service';
import { MemoryService } from '../memory/memory.service';
import { SummaryService } from '../memory/summary.service';
import { LeadAlertService } from './lead-alert.service';
import { TurnstileService } from './turnstile.service';
import { ListToolsService } from '../agent-tools/list-tools.service';
import {
  confirmedWrite,
  doneSteps,
  type PublicConfirmation,
  type PublicStep,
} from './live-steps';
import { FEEDBACK_UPSERT } from './answer-feedback.sql';
import { ChatPrivacyService } from '../privacy/chat-privacy.service';
import { AnswerConflictService } from '../knowledge/answer-conflict.service';
import { CRISIS_LINK } from '../safety/crisis-copy';
import { packFor } from '../../bot-draft/safety-pack/safety-packs';

/** What a visitor's browser learns about a page. Nothing internal: no prompts, ids or settings. */
export interface PublicBotPage {
  /** The legacy link's key, for older clients. */
  slug: string;
  /** The page's address (`/chat/<publicId>`, stage 7): a page opened by its old link goes here. */
  publicId: string;
  access: BotPageAccess;
  /** Stage 7: the look is the name, the logo, one accent colour and a short welcome line. */
  branding: PublicBranding;
  suggestedQuestions: string[];
  prechat: PrechatField[];
  maxMessageChars: number;
  language: AvailableBotPage['settings']['language'];
  /** Set when the page needs a Turnstile token to start a session. */
  turnstileSiteKey: string | null;
  /**
   * The chatbot's crisis information (R6), shown on the sign-in screen to every visitor before
   * any code is asked for, and under a blocked reply: the builder's own numbers first when set,
   * then the helpline link.
   */
  crisis: { numbers: string | null; helplineUrl: string };
  /**
   * The fixed notice that an AI and people at the organisation may read the chat (stage 4), shown
   * on the page's first screen on every channel. Never empty: the owner's wording only when it
   * keeps that meaning.
   */
  notice: string;
  /**
   * The safety pack's required disclaimer (a health pack's "not a crisis service or medical
   * advice"), or the owner's longer wording that still contains it. Null when the bot's pack needs
   * none, or when `notice` already carries it. The free-text disclaimer is otherwise retired
   * (stage 7), but a pack's can't be removed.
   */
  disclaimer: string | null;
}

/**
 * The disclaimer a page must show: the pack's own text, or the owner's stored wording when it still
 * contains it (the draft lock only lets an owner lengthen it). Null without a pack that needs one.
 */
export function requiredDisclaimer(
  safetyPack: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const required = packFor(safetyPack)?.disclaimer?.trim();
  if (!required) return null;
  const own = (stored ?? '').trim();
  return own && own.includes(required) ? own : required;
}

/**
 * How the page looks to a visitor (stage 7). No subtitle, avatar, disclaimer (the fixed crisis
 * notice owns that), footer link, cover, theme or heading style: stored values of those are inert.
 */
export interface PublicBranding {
  /** The business's name. */
  title: string;
  /** The name on the bot's replies (the assistant's name). */
  assistantName: string;
  logoUrl: string | null;
  /** The colour to paint with: the owner's accent, darkened until white text reads on it. */
  accentColour: string;
  /** The owner's accent as chosen. */
  accent: string;
  /** Same as `accentColour`, named for what it is. */
  accentContrast: string;
  /** One short welcome line; empty when the owner set none. */
  welcome: string;
  /** Image URLs on the public image route; no ids. */
  look: { accent: string; logo: AvailableBotPage['brandImages']['logo'] };
}

type SessionState = 'ready' | 'needs_email' | 'needs_code';

export interface PublicSession {
  state: SessionState;
  /** Whether the pre-chat questions still have to be answered before the first message. */
  intakeDone: boolean;
  /** The masked email the visitor verified, for "Signed in as a***@example.com". */
  signedInAs: string | null;
  /**
   * The website widget's visitor token, only when it asked because its browser drops even the
   * partitioned cookie (chunk 13). Held in the frame's memory, never stored.
   */
  visitorToken?: string;
}

/** What the widget's loader draws the bubble from. No ids, nothing internal. */
export interface WidgetConfig {
  position: 'right' | 'left';
  label: string;
  autoOpenSeconds: number | null;
  showOnPhones: boolean;
  accent: string;
  logo: string | null;
  /** The business, for the panel's title ("Chat with {business}"). */
  title: string;
  /** The bot page; the panel frames it with `?embed=1`. */
  pageUrl: string;
}

/** The widget asks for its token in the session answer with this header (its cookie check failed). */
const EMBED_TOKEN_HEADER = 'x-ally-embed-token';

/** A source under an answer: what it's called, and a link when the document has one. */
export interface PublicCitation {
  title: string;
  url: string | null;
}

export interface PublicMessage {
  id: string;
  /** `agent_human`: a team member replying from the inbox (chunk 11a). */
  role: 'user' | 'assistant' | 'agent_human';
  /** For a team member's reply: "{first name} from {business}", or the business. */
  sender?: string;
  text: string;
  citations: PublicCitation[];
  createdAt: string;
  /** Whether "Was this helpful?" shows under it (chunk Q2a): never on a crisis reply. */
  rateable: boolean;
}

/** The stream's `final`: the reply as stored, never the run behind it. */
export interface PublicFinal {
  reply: string;
  citations: PublicCitation[];
  messageId: string;
  conversationId: string;
  /** Whether "Was this helpful?" shows under it (chunk Q2a). */
  rateable: boolean;
  /** A team member has this chat (chunk 11a): no reply now; theirs comes on the visitor stream. */
  held?: boolean;
  /**
   * What the assistant did for this reply, for its "what I did" line (chunk 6b). Absent for a v1,
   * crisis or Safety reply, a template, or one that did nothing worth showing.
   */
  steps?: PublicStep[];
  /** A booking or change made in this reply, from the stored record (chunk 6b). */
  confirmation?: PublicConfirmation;
  /** BT1: chips and cards built from what the run's tools did; each button carries its token. */
  parts?: ReplyParts;
  /**
   * Stage 6: the turn was blocked and `reply` is the fixed notification (no model call), or on a
   * crisis keyword the crisis reply. The page shows it with the crisis information.
   */
  blocked?: 'OUT_OF_CREDITS' | 'REMOVED_FROM_LIST';
}

/** The bot page's refusals, mapped onto the repo's `ErrorCode` contract (see error-code.enum.ts). */
const PUBLIC_ERRORS = {
  not_found: ErrorCode.BOT_PAGE_NOT_FOUND,
  bot_check_failed: ErrorCode.BOT_PAGE_BOT_CHECK_FAILED,
  start_again: ErrorCode.BOT_PAGE_START_AGAIN,
  not_allowed: ErrorCode.BOT_PAGE_NOT_ALLOWED,
  // Stage 6: a verified visitor taken off the list sends a message: the fixed notification.
  not_on_list: ErrorCode.BOT_PAGE_NOT_ON_LIST,
  out_of_credits: ErrorCode.BOT_PAGE_OUT_OF_CREDITS,
  code_wrong: ErrorCode.BOT_PAGE_CODE_WRONG,
  code_expired: ErrorCode.BOT_PAGE_CODE_EXPIRED,
  code_too_many: ErrorCode.BOT_PAGE_CODE_TOO_MANY,
  email_failed: ErrorCode.BOT_PAGE_EMAIL_UNAVAILABLE,
  rate_limited: ErrorCode.BOT_PAGE_THROTTLED,
  busy: ErrorCode.BOT_PAGE_BUSY_UNAVAILABLE,
  too_long: ErrorCode.BOT_PAGE_MESSAGE_TOO_LONG,
  intake_required: ErrorCode.BOT_PAGE_INTAKE_REQUIRED,
  intake_invalid: ErrorCode.BOT_PAGE_INTAKE_INVALID,
  not_rateable: ErrorCode.BOT_PAGE_NOT_RATEABLE,
  host_not_allowed: ErrorCode.BOT_PAGE_HOST_NOT_ALLOWED,
} as const;

export type PublicErrorCode = keyof typeof PUBLIC_ERRORS;

/**
 * A refusal the page can explain: `errorCode` says what happened (the page has its own words for
 * each), `details` carries what it needs to say it (the longest message, the question that was
 * refused), and `retryAfterSeconds` becomes the Retry-After header.
 */
export function publicError(
  status: HttpStatus,
  code: PublicErrorCode,
  extra: {
    retryAfterSeconds?: number;
    details?: Record<string, unknown>;
    message?: string;
  } = {},
): HttpException {
  return new HttpException(
    {
      statusCode: status,
      error: code,
      message: extra.message ?? code.replace(/_/g, ' '),
      errorCode: PUBLIC_ERRORS[code],
      ...(extra.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: extra.retryAfterSeconds }
        : {}),
      ...(extra.details ? { details: extra.details } : {}),
    },
    status,
  );
}

/** The bot page's channel: it streams, and shows longer replies than WhatsApp. */
export const WEB_CHANNEL: ChatChannel = {
  type: 'web',
  capabilities: {
    streaming: true,
    showsSources: true,
    maxReplyChars: BOT_PAGE_BOUNDS.maxReplyChars,
  },
};

/** A visitor allowed to chat, with who they turned out to be. */
interface ReadyVisitor {
  visitor: BotPageVisitor;
  email: string | null;
  eligibility: BotPageEligibility;
}

/** Answers a visitor can rate (chunk Q2a): the assistant's own, never a crisis reply or template. */
const RATEABLE = new Set<string>([
  WaHandledBy.RAG,
  WaHandledBy.DECLINED,
  WaHandledBy.CLARIFIED,
]);

/**
 * The bot page's public side (chunk 12b): sessions, codes, pre-chat answers and messages.
 *
 * A channel like WhatsApp inbound, in the same order: the page and bot are available, the visitor
 * may use it, the limits allow it, the message is stored, the engine decides (crisis keywords, the
 * classifier and the held tokens all live in the engine), the reply is stored, gaps are filed and
 * alerts raised. Visitors see replies and sources; runs, steps and settings stay in the dashboard.
 */
@Injectable()
export class BotPagePublicService {
  private readonly logger = LoggerService.getInstance(
    BotPagePublicService.name,
  );

  constructor(
    private readonly pages: BotPageService,
    private readonly pageAccess: BotPageAccessService,
    private readonly visitors: BotPageVisitorService,
    private readonly otp: BotPageOtpService,
    private readonly limits: BotPageRateLimitService,
    private readonly turnstile: TurnstileService,
    private readonly conversations: ConversationService,
    private readonly engine: ChatbotEngineService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: AppConfigService,
    private readonly leads: LeadAlertService,
    private readonly handover: HandoverService,
    private readonly inboxEvents: InboxEventsService,
    @InjectRepository(WaUnansweredQuestion)
    private readonly unansweredRepository: Repository<WaUnansweredQuestion>,
    // Memory, light (chunk 8a). Optional so older test wiring still builds the service.
    @Optional() private readonly memory?: MemoryService,
    @Optional() private readonly summaries?: SummaryService,
    // The confirmation card (chunk 6b). Optional, like memory, for older test wiring.
    @Optional() private readonly listTools?: ListToolsService,
    // Stage 5: erase in chat, memory consent, conflicts. Optional for older test wiring.
    @Optional() private readonly privacy?: ChatPrivacyService,
    @Optional() private readonly answerConflict?: AnswerConflictService,
    // Stage 7: "Sites it has loaded on". Optional for older test wiring.
    @Optional() private readonly widgetSites?: WidgetSitesService,
    // BT1: taps and a reply's chips and cards. Optional for older test wiring.
    @Optional() private readonly actions?: ActionsService,
    @Optional() private readonly parts?: ActionPartsService,
  ) {}

  async page(slug: string): Promise<AvailableBotPage> {
    const available = await this.pages.findAvailable(slug);
    if (!available) {
      // Stage 4: an archived or paused assistant shows its off message with the crisis
      // information, which can't be removed, rather than a bare "not found".
      const off = await this.pages.findOff?.(slug).catch(() => null);
      if (off) {
        throw publicError(HttpStatus.NOT_FOUND, 'not_found', {
          details: {
            assistantOff: off.reason,
            offMessage: offMessage(off.chatbot as never, 'en'),
          },
        });
      }
      throw publicError(HttpStatus.NOT_FOUND, 'not_found');
    }
    return available;
  }

  view(available: AvailableBotPage): PublicBotPage {
    const { page, settings } = available;
    // `findAvailable` has already put the contrast-corrected accent and the stored logo's URL
    // into `branding`.
    const paint = settings.branding.accentColour;
    return {
      slug: page.slug,
      publicId: page.publicId,
      access: page.access,
      branding: {
        title: settings.branding.title,
        assistantName: settings.branding.assistantName,
        logoUrl: settings.branding.logoUrl,
        accentColour: paint,
        accent: settings.brand?.accent ?? paint,
        accentContrast: paint,
        welcome: settings.branding.welcome ?? '',
        look: { accent: paint, logo: available.brandImages?.logo ?? null },
      },
      suggestedQuestions: settings.suggestedQuestions,
      prechat: settings.prechat,
      maxMessageChars: Math.min(
        settings.limits.maxMessageChars,
        BOT_PAGE_BOUNDS.maxMessageChars,
      ),
      language: settings.language,
      turnstileSiteKey:
        page.access === BotPageAccess.PUBLIC ? this.turnstile.siteKey : null,
      // The builder's own numbers only (R6): never the platform's defaults. Q4 G7: confirmed ones.
      crisis: {
        numbers: crisisHelplines(available.chatbot.settings) || null,
        helplineUrl: CRISIS_LINK,
      },
      ...this.notices(available),
    };
  }

  /**
   * The page's fixed notice and its pack's required disclaimer. When the notice already carries
   * the disclaimer (the owner's wording includes it), `disclaimer` is null so it isn't shown twice:
   * the pack's text is on the page either way.
   */
  private notices(
    available: AvailableBotPage,
  ): Pick<PublicBotPage, 'notice' | 'disclaimer'> {
    const { settings, chatbot } = available;
    const notice = startNotice({
      disclaimer:
        available.botSettings?.disclaimerText ??
        chatbot.settings?.disclaimerText ??
        '',
      language: replyLanguageOf('', settings.language),
      organisation: settings.branding.title || chatbot.name,
    });
    const disclaimer = requiredDisclaimer(
      chatbot.safetyPack,
      settings.branding.disclaimer,
    );
    const required = packFor(chatbot.safetyPack)?.disclaimer?.trim() ?? '';
    const inNotice = Boolean(required) && notice.includes(required);
    return { notice, disclaimer: inNotice ? null : disclaimer };
  }

  // ── session and codes ─────────────────────────────────────────────────

  async session(
    slug: string,
    dto: BotPageSessionDto,
    req: Request,
    res: Response,
  ): Promise<PublicSession> {
    const available = await this.page(slug);
    await this.ipLimit(req, 'session', BOT_PAGE_IP_LIMITS.session.perHour);
    const { page, chatbot } = available;
    const embed = this.embedOf(available, req, dto.embed);
    let visitor = await this.visitors.read(req, chatbot.id);
    if (visitor) visitor = { ...visitor, embed };

    if (page.access === BotPageAccess.PUBLIC) {
      if (!visitor) {
        if (!(await this.turnstile.verify(dto.turnstileToken, req.ip))) {
          throw publicError(HttpStatus.FORBIDDEN, 'bot_check_failed');
        }
        visitor = { ...this.visitors.newVisitor(chatbot.id), embed };
      }
      const issued = await this.visitors.issue(res, visitor);
      return withToken(
        req,
        issued,
        await this.sessionFor(available, {
          visitor: issued,
          email: null,
          eligibility: { eligible: true },
        }),
      );
    }

    // Organisation and invite pages: a visitor who proved an email recently, and still may, is in.
    if (visitor?.verifiedAt) {
      const ready = await this.recheck(available, visitor);
      if (ready) {
        const issued = await this.visitors.issue(res, visitor);
        return withToken(req, issued, await this.sessionFor(available, ready));
      }
    }

    if (!dto.email) {
      return { state: 'needs_email', intakeDone: false, signedInAs: null };
    }
    const email = BotPageAccessService.tryNormaliseEmail(dto.email);
    if (!email) throw publicError(HttpStatus.BAD_REQUEST, 'not_allowed');

    if (!visitor) visitor = { ...this.visitors.newVisitor(chatbot.id), embed };
    // A new code for an address the visitor typed: whatever they had proved before no longer counts.
    const issued = await this.visitors.issue(res, {
      ...visitor,
      verifiedAt: null,
    });

    const eligibility = await this.pageAccess.eligibility(page, email);
    if (eligibility.eligible) {
      // Not awaited, and its outcome never changes the answer (D4): a per-address cap or a failed
      // email on a listed address would otherwise answer differently from an unlisted one, and
      // the time an email takes would too. Logged for the team instead.
      void this.otp
        .send(chatbot.id, email, {
          title: available.settings.branding.title,
          logoUrl: available.settings.branding.logoUrl,
          accentColour: available.settings.branding.accentColour,
        })
        .then((sent) => {
          if (sent === 'too_many' || sent === 'failed') {
            this.logger.warn(
              `Bot page ${page.slug}: sign-in code not sent (${sent})`,
            );
          }
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Bot page ${page.slug}: sign-in code not sent (${
              error instanceof Error ? error.message : 'error'
            })`,
          ),
        );
    }
    // The same answer whether or not the address may use the page, so the page can't be used to
    // find out who is invited.
    return withToken(req, issued, {
      state: 'needs_code',
      intakeDone: false,
      signedInAs: null,
    });
  }

  async verify(
    slug: string,
    dto: BotPageVerifyDto,
    req: Request,
    res: Response,
  ): Promise<PublicSession> {
    const available = await this.page(slug);
    await this.ipLimit(req, 'verify', BOT_PAGE_IP_LIMITS.verify.perHour);
    const embed = this.embedOf(available, req, dto.embed);
    const read = await this.visitors.read(req, available.chatbot.id);
    if (!read || available.page.access === BotPageAccess.PUBLIC) {
      throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    }
    const visitor = { ...read, embed };
    const email = BotPageAccessService.tryNormaliseEmail(dto.email);
    if (!email) throw publicError(HttpStatus.BAD_REQUEST, 'code_wrong');

    const result = await this.otp.check(available.chatbot.id, email, dto.code);
    if (result !== 'ok') {
      const code =
        result === 'wrong'
          ? 'code_wrong'
          : result === 'expired'
            ? 'code_expired'
            : 'code_too_many';
      throw publicError(HttpStatus.BAD_REQUEST, code);
    }
    // A code is only ever sent to an eligible address, but access can change in ten minutes.
    const eligibility = await this.pageAccess.eligibility(
      available.page,
      email,
    );
    if (!eligibility.eligible) {
      throw publicError(HttpStatus.FORBIDDEN, 'not_allowed');
    }
    const now = new Date();
    await this.conversations.resolveVerifiedContact(
      { chatbotId: available.chatbot.id },
      { channel: ConversationChannel.EMAIL, externalId: email },
      { channel: ConversationChannel.WEB, externalId: visitor.id },
      now,
    );
    const verified = await this.visitors.issue(res, {
      ...visitor,
      verifiedAt: now,
    });
    this.logger.info(
      `Bot page ${available.page.slug}: visitor ${BotPageVisitorService.logTag(visitor.id)} verified (${email.slice(email.lastIndexOf('@'))})`,
    );
    return withToken(
      req,
      verified,
      await this.sessionFor(available, {
        visitor: verified,
        email,
        eligibility,
      }),
    );
  }

  // ── pre-chat, resume, new chat ────────────────────────────────────────

  async intake(
    slug: string,
    dto: BotPageIntakeDto,
    req: Request,
  ): Promise<{ intakeDone: true }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    let intake: StoredIntake;
    try {
      intake = validateIntake(available.settings.prechat, dto.answers);
    } catch (error) {
      if (error instanceof IntakeError) {
        throw publicError(HttpStatus.BAD_REQUEST, 'intake_invalid', {
          message: error.message,
          details: { field: error.fieldId },
        });
      }
      throw error;
    }
    const contact = await this.contactOf(available, ready, true);
    const conversation = await this.conversations.openConversation(
      available.chatbot.id,
      contact!.id,
      ConversationChannel.WEB,
      { idleWindowMinutes: available.botSettings.conversationIdleMinutes },
    );
    await this.conversations.setMetadata(conversation.id, {
      intake,
      ...sourceOf(ready, conversation),
    });
    // The name they gave before the chat is the contact's, unless it has one (chunk 8a): the
    // assistant then knows it and never asks again.
    const name = intakeName(intake);
    if (name)
      await this.memory?.nameIfUnnamed(available.chatbot.id, contact!.id, name);
    return { intakeDone: true };
  }

  async conversation(
    slug: string,
    req: Request,
  ): Promise<{ conversationId: string | null; messages: PublicMessage[] }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    const contact = await this.contactOf(available, ready, false);
    const current = contact
      ? await this.conversations.currentConversation(
          available.chatbot.id,
          contact.id,
          ConversationChannel.WEB,
          available.botSettings.conversationIdleMinutes,
        )
      : null;
    if (!current) return { conversationId: null, messages: [] };
    const rows = await this.conversations.recentMessages(
      current.id,
      BOT_PAGE_BOUNDS.resumeMessages,
    );
    return {
      conversationId: current.id,
      messages: rows
        .filter((row) => row.text?.trim())
        .map((row) => ({
          id: row.id,
          role:
            row.role === ConversationMessageRole.USER
              ? 'user'
              : row.role === ConversationMessageRole.AGENT_HUMAN
                ? 'agent_human'
                : 'assistant',
          ...(row.role === ConversationMessageRole.AGENT_HUMAN
            ? { sender: String(row.retrievalMeta?.sender_label ?? '') }
            : {}),
          text: row.text,
          citations: publicCitations(row.citations),
          createdAt: row.createdAt.toISOString(),
          rateable:
            row.role !== ConversationMessageRole.USER &&
            RATEABLE.has(row.handledBy ?? ''),
        })),
    };
  }

  async newConversation(slug: string, req: Request): Promise<{ ok: true }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    const contact = await this.contactOf(available, ready, false);
    if (!contact) return { ok: true };
    const current = await this.conversations.currentConversation(
      available.chatbot.id,
      contact.id,
      ConversationChannel.WEB,
      available.botSettings.conversationIdleMinutes,
    );
    if (current) await this.conversations.closeConversation(current.id);
    return { ok: true };
  }

  // ── a message ─────────────────────────────────────────────────────────

  /**
   * Everything that can refuse a message, before any of it is stored or streamed: the page, the
   * visitor, the length, the limits, and the pre-chat questions. Refusals are plain HTTP errors
   * with a `code`, so the page can explain them. A crisis keyword message (R1) skips the limits and
   * the pre-chat questions.
   */
  async admit(
    slug: string,
    text: string,
    req: Request,
    res: Response,
  ): Promise<{
    available: AvailableBotPage;
    ready: ReadyVisitor;
    text: string;
  }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req, {
      removedCode: 'not_on_list',
    });
    const trimmed = (text ?? '').trim();
    const max = Math.min(
      available.settings.limits.maxMessageChars,
      BOT_PAGE_BOUNDS.maxMessageChars,
    );
    if (!trimmed || trimmed.length > max) {
      throw publicError(HttpStatus.BAD_REQUEST, 'too_long', {
        details: { max },
      });
    }

    await this.ipLimit(req, 'messages', BOT_PAGE_IP_LIMITS.messages.perHour);
    // R1 / stage 7: the free keyword crisis check runs first, and a crisis message is never held
    // back by the person's hourly or daily limit or the bot's daily cap (its reply is model-free).
    const crisis = await this.crisisKeyword(trimmed, available.chatbot.id);
    if (!crisis) {
      const perVisitor = await this.limits.hourly(
        `v:${available.chatbot.id}:${ready.visitor.id}`,
        available.settings.limits.messagesPerVisitorPerHour,
      );
      if (!perVisitor.allowed) {
        throw publicError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', {
          retryAfterSeconds: perVisitor.retryAfterSeconds,
        });
      }
      const perDay = await this.limits.daily(
        `v:${available.chatbot.id}:${ready.visitor.id}`,
        available.settings.limits.messagesPerVisitorPerDay ??
          DEFAULT_BOT_PAGE_LIMITS.messagesPerVisitorPerDay,
      );
      if (!perDay.allowed) {
        throw publicError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', {
          retryAfterSeconds: perDay.retryAfterSeconds,
          details: { window: 'day' },
        });
      }
    }

    // A crisis message is never held back by unanswered pre-chat questions either: it is accepted
    // and the engine answers it with the crisis reply. The questions still apply to the next one.
    if (!crisis && intakeRequired(available.settings.prechat)) {
      const contact = await this.contactOf(available, ready, false);
      const current = contact
        ? await this.conversations.currentConversation(
            available.chatbot.id,
            contact.id,
            ConversationChannel.WEB,
            available.botSettings.conversationIdleMinutes,
          )
        : null;
      const done =
        Boolean(current?.metadata?.intake) ||
        Boolean(contact && (await this.latestIntake(contact.id)));
      if (!done) throw publicError(HttpStatus.CONFLICT, 'intake_required');
    }

    if (!crisis) {
      const cap = await this.limits.dailyCap(
        available.chatbot.id,
        available.settings.limits.dailyCapPerBot,
      );
      if (!cap.allowed) {
        throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'busy');
      }
    }

    await this.visitors.rotateIfDue(res, ready.visitor);
    return { available, ready, text: trimmed };
  }

  /**
   * Answer one admitted message and store both sides. With `live`, status codes and checked text
   * stream as they happen; the result is the same object either way, and it is the stream's
   * `final`.
   */
  async respond(
    admitted: {
      available: AvailableBotPage;
      ready: ReadyVisitor;
      text: string;
      /** BT1: a tap's token; `text` is then the label tapped. */
      action?: string;
    },
    live?: LiveReply,
  ): Promise<PublicFinal> {
    const { available, ready } = admitted;
    const { chatbot, botSettings } = available;
    const contact = (await this.contactOf(available, ready, true))!;
    const conversation = await this.openWithIntake(available, contact, ready);
    // BT1: a tap counts only in its own conversation, for its own person; the message stored and
    // answered is what it stands for ("Confirmed: Sun 29 Nov 2026, 11:00").
    const tap =
      admitted.action && this.actions
        ? await this.actions.redeem(admitted.action, {
            chatbotId: chatbot.id,
            conversationId: conversation.id,
            contactId: contact.id,
          })
        : undefined;
    const text = tap?.ok ? tap.claims.text : admitted.text;

    const inbound = await this.conversations.appendMessage(conversation.id, {
      channel: ConversationChannel.WEB,
      direction: WaMessageDirection.INBOUND,
      role: ConversationMessageRole.USER,
      text,
      status: WaMessageStatus.PROCESSING,
    });

    const startedAt = Date.now();
    let decision: ChatbotDecision;
    let isFirstMessage = false;
    // Stage 5: erase in chat (the signed-in visitor's contact) and the consent answer, after the
    // free crisis keyword check. Model-free fixed replies; the engine does not run for them.
    const fixed = this.privacy
      ? await this.privacy.beforeTurn({
          chatbot,
          conversationId: conversation.id,
          contactId: contact.id,
          email: ready.email,
          text,
          crisisKeyword: await this.engine.isCrisisKeyword(
            text,
            null,
            chatbot.id,
          ),
        })
      : null;
    try {
      const history = await this.conversations.recentHistory(conversation.id);
      isFirstMessage = history.length <= 1;
      // CR1: the bubble is its own channel on the Costs screen; the turn stays the page's.
      decision = fixed
        ? { handledBy: fixed.handledBy, body: fixed.body }
        : await usageContext.with(
            {
              channel: ready.visitor.embed
                ? UsageChannel.BUBBLE
                : UsageChannel.BOT_PAGE,
              runKind: UsageKind.CUSTOMER_REPLY,
              // CR1: on an invite-only or organisation page the signed-in person holds a seat.
              audience:
                available.page.access === BotPageAccess.PUBLIC
                  ? 'customer'
                  : 'seat',
              seatEmail: ready.email ?? null,
            },
            () =>
              this.engine.respond(
                {
                  // The page's own gate has already decided who may chat here; the bot's accessMode is
                  // WhatsApp's (and every other channel's) list, and the page must neither use nor widen it.
                  chatbot: { ...chatbot, accessMode: ChatbotAccessMode.ANYONE },
                  settings: botSettings,
                  text,
                  history,
                  isFirstMessage: history.length <= 1,
                  sender: {
                    externalId: ready.visitor.id,
                    label: `bot page visitor ${BotPageVisitorService.logTag(ready.visitor.id)}`,
                    email: ready.email,
                    userId: ready.eligibility.userId ?? null,
                    tenantId: ready.eligibility.tenantId ?? null,
                  },
                  channel: WEB_CHANNEL,
                  conversationId: conversation.id,
                  providerMessageId: inbound.id,
                  contactId: contact.id,
                  ...(tap ? { tap } : {}),
                },
                live,
              ),
          );
    } catch (error) {
      await this.conversations.updateMessage(inbound.id, {
        status: WaMessageStatus.FAILED,
        errorMessage:
          error instanceof Error ? error.message : 'unknown failure',
      });
      throw error;
    }

    // A team member has this chat (chunk 11a): the engine didn't answer and nothing is stored as a
    // reply. The visitor's message stays for the team; their reply comes on the visitor stream.
    if (decision.held) {
      await this.conversations.updateMessage(inbound.id, {
        status: WaMessageStatus.SENT,
        handledBy: WaHandledBy.HELD,
      });
      await this.handover.afterDecision(chatbot, conversation.id, decision);
      return {
        reply: '',
        citations: [],
        messageId: inbound.id,
        conversationId: conversation.id,
        rateable: false,
        held: true,
      };
    }
    // Safety, Needs a person, and a second "I don't know" becoming the hand-over message.
    if (!fixed) {
      decision = await this.handover.afterDecision(
        chatbot,
        conversation.id,
        decision,
      );
    }

    // Stage 4: the conversation's first reply carries the fixed start notice (bot page and widget).
    if (isFirstMessage) {
      decision = {
        ...decision,
        body: withFirstMessageParts({
          body: decision.body,
          handledBy: decision.handledBy,
          bodyIsWelcome: decision.isWelcome,
          notice: startNotice({
            disclaimer: botSettings.disclaimerText ?? '',
            language: replyLanguageOf(text),
            organisation: chatbot.name,
          }),
        }),
      };
    }

    // Stage 5 (D7): with memory on, the one consent question follows the agent's own reply (after the start notice).
    const consentQuestion = await this.privacy?.consentQuestion({
      chatbot,
      contactId: contact.id,
      decision,
      text,
    });
    if (consentQuestion) {
      decision = {
        ...decision,
        body: `${decision.body}\n\n${consentQuestion}`,
      };
    }

    const outbound = await this.conversations.appendMessage(conversation.id, {
      channel: ConversationChannel.WEB,
      direction: WaMessageDirection.OUTBOUND,
      role: ConversationMessageRole.ASSISTANT,
      text: decision.body,
      status: WaMessageStatus.SENT,
      handledBy: decision.handledBy,
      templateId: decision.templateId ?? null,
      citations: decision.citations ?? null,
      retrievalMeta: decision.retrievalMeta ?? null,
      language: decision.language ?? null,
      latencyMs: Date.now() - startedAt,
      agentRunId: decision.agent?.runId ?? null,
      agentRuntime: decision.agent?.runtime ?? null,
      inReplyToId: inbound.id,
    });
    await this.conversations.updateMessage(inbound.id, {
      status: WaMessageStatus.SENT,
      handledBy: decision.handledBy,
    });

    // Stage 5: two sources disagreed; the owner gets a question naming them (one row per message,
    // so the generic gap row below is then ignored).
    if (decision.conflict && this.answerConflict) {
      await this.answerConflict
        .recordConflict({
          conversationId: conversation.id,
          messageId: inbound.id,
          question: text,
          language: decision.language ?? null,
          result: decision.conflict,
        })
        .catch(() => undefined);
    }
    if (decision.unanswered) {
      await this.fileUnanswered(inbound.id, conversation.id, text, decision);
    }
    if (decision.alert) this.eventEmitter.emit('exception', decision.alert);
    // A "Bring in customers" assistant tells its owners about a new lead, once (chunk 20a-2).
    // Not awaited: the reply never waits on email.
    void this.leads.afterTurn(chatbot, conversation.id);
    // What the run asked to remember, and the chat's rolling summary (chunk 8a): after the reply
    // has gone out, decided from what was stored as sent. Not awaited: nobody waits for either.
    // CR1: both are this channel's calls for the Costs screen.
    usageContext.run(
      {
        channel: ready.visitor.embed
          ? UsageChannel.BUBBLE
          : UsageChannel.BOT_PAGE,
        runKind: UsageKind.CUSTOMER_REPLY,
        chatbotId: chatbot.id,
        creatorUserId: chatbot.createdBy ?? null,
        // Stage 6: the payer stamped on the turn (the chatbot's budget) pays for these too.
        payerAccountId: decision.payer?.accountId ?? null,
        endPersonId: decision.payer?.endPersonId ?? null,
      },
      () => {
        void this.memory?.afterTurn({
          chatbot,
          conversationId: conversation.id,
          runId: decision.agent?.runId,
          pending:
            decision.agent?.runtime === AgentRuntimeUsed.V2
              ? decision.agent.memory
              : undefined,
          repliedAt: Date.now(),
        });
        void this.summaries?.afterTurn(chatbot, conversation.id);
      },
    );
    if (isFailedRun(decision.agent)) {
      this.eventEmitter.emit(AGENT_FALLBACK_EVENT, {
        chatbot: { id: chatbot.id, name: chatbot.name },
        reason: decision.agent.fallbackReason,
      } satisfies AgentFallbackEvent);
    }

    const steps = doneSteps(decision);
    const confirmation = await this.confirmationFor(
      chatbot.id,
      contact.id,
      decision,
    );
    // BT1: chips and cards from what this run's tools did, never from the reply's words; none on
    // a crisis, blocked or fixed reply.
    const parts = await this.parts?.partsFor({
      chatbotId: chatbot.id,
      conversationId: conversation.id,
      contactId: contact.id,
      runId: decision.agent?.runId,
      language: replyLanguageOf(text, decision.language),
      suppressed:
        Boolean(fixed) ||
        decision.handledBy === WaHandledBy.CRISIS ||
        Boolean(decision.blocked) ||
        Boolean(decision.off),
      answered: decision.handledBy === WaHandledBy.RAG,
      starters: available.settings.suggestedQuestions ?? [],
      asked: (await this.conversations.recentHistory(conversation.id))
        .filter((m) => m.role === 'user')
        .map((m) => m.content),
    });
    return {
      reply: decision.body,
      citations: publicCitations(decision.citations),
      messageId: outbound.id,
      conversationId: conversation.id,
      rateable: RATEABLE.has(decision.handledBy),
      ...(steps.length ? { steps } : {}),
      ...(confirmation ? { confirmation } : {}),
      ...(parts && Object.keys(parts).length ? { parts } : {}),
      ...(decision.blocked === 'OUT_OF_CREDITS' ||
      decision.blocked === 'REMOVED_FROM_LIST'
        ? { blocked: decision.blocked }
        : {}),
    };
  }

  /**
   * The card under a reply that booked or changed something (chunk 6b): the record as stored and
   * as this person may see it, never the model's account of it. Nothing if it can't be read.
   */
  private async confirmationFor(
    chatbotId: string,
    contactId: string,
    decision: ChatbotDecision,
  ): Promise<PublicConfirmation | null> {
    const write = confirmedWrite(decision);
    if (!write || !this.listTools || !decision.agent) return null;
    try {
      const record = await this.listTools.confirmation(
        chatbotId,
        write.record_id,
        contactId,
        decision.agent.runId,
      );
      if (!record) return null;
      return {
        action: write.kind as PublicConfirmation['action'],
        ...record,
      };
    } catch (error) {
      // The reply has gone out; a card that can't be read is left off, never an error.
      this.logger.warn(
        `Confirmation card unavailable: ${error instanceof Error ? error.name : 'error'}`,
      );
      return null;
    }
  }

  /**
   * "Was this helpful?" (chunk Q2a): the visitor's thumbs up or down on one of the answers in
   * their own conversation. Rating again changes it. Crisis replies, templates and the consent
   * gate can't be rated. Nothing they wrote is logged. How a repeat is stored:
   * `answer-feedback.sql.ts`.
   */
  async feedback(
    slug: string,
    messageId: string,
    dto: BotPageFeedbackDto,
    req: Request,
  ): Promise<{ rating: 'up' | 'down' }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    await this.ipLimit(req, 'feedback', BOT_PAGE_IP_LIMITS.feedback.perHour);
    const contact = await this.contactOf(available, ready, false);
    const db = this.unansweredRepository.manager;
    const [message] = contact
      ? ((await db.query(
          `SELECT m.id, m.conversation_id, m.direction, m.handled_by
             FROM chatbot_messages m
             JOIN chatbot_conversations c ON c.id = m.conversation_id
            WHERE m.id = $1 AND c.chatbot_id = $2 AND c.contact_id = $3`,
          [messageId, available.chatbot.id, contact.id],
        )) as {
          id: string;
          conversation_id: string;
          direction: string;
          handled_by: string | null;
        }[])
      : [];
    if (!message || message.direction !== WaMessageDirection.OUTBOUND) {
      throw publicError(HttpStatus.NOT_FOUND, 'not_found');
    }
    if (!RATEABLE.has(message.handled_by ?? '')) {
      throw publicError(HttpStatus.CONFLICT, 'not_rateable');
    }
    const down = dto.rating === 'down';
    await db.query(FEEDBACK_UPSERT, [
      message.id,
      available.chatbot.id,
      message.conversation_id,
      dto.rating,
      down ? (dto.reason ?? null) : null,
      down ? dto.note?.trim().slice(0, 300) || null : null,
    ]);
    return { rating: dto.rating };
  }

  // ── a person (chunk 11a) ──────────────────────────────────────────────

  /**
   * "Talk to a person": the same hand-over as asking in words. The visitor is told the team has been
   * asked; a chat a team member already has just says so again.
   */
  async askForPerson(
    slug: string,
    req: Request,
  ): Promise<{ reply: string; messageId: string; conversationId: string }> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    const contact = (await this.contactOf(available, ready, true))!;
    const conversation = await this.openWithIntake(available, contact, ready);
    const reply = handoverMessage(
      handoverOf(available.botSettings),
      new Date(),
    );
    const stored = await this.conversations.appendMessage(conversation.id, {
      channel: ConversationChannel.WEB,
      direction: WaMessageDirection.OUTBOUND,
      role: ConversationMessageRole.ASSISTANT,
      text: reply,
      status: WaMessageStatus.SENT,
      handledBy: WaHandledBy.HANDOVER,
    });
    await this.handover.markNeedsPerson(
      available.chatbot.id,
      conversation.id,
      'asked',
    );
    return { reply, messageId: stored.id, conversationId: conversation.id };
  }

  /**
   * The visitor's live stream (chunk 11a): who has the chat now (`hello`), then a team member's
   * replies and changes of hands as they happen. Their current chat only; none yet ends it at once.
   */
  async visitorStream(
    slug: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const available = await this.page(slug);
    const ready = await this.requireReady(available, req);
    const contact = await this.contactOf(available, ready, false);
    const current = contact
      ? await this.conversations.currentConversation(
          available.chatbot.id,
          contact.id,
          ConversationChannel.WEB,
          available.botSettings.conversationIdleMinutes,
        )
      : null;
    const sse = new SseWriter(res);
    const holder = current
      ? await this.conversations.holderOf(current.id)
      : null;
    sse.send('hello', {
      conversationId: current?.id ?? null,
      by: holder === null ? 'assistant' : 'person',
    });
    if (!current) return sse.end();
    const stop = await this.inboxEvents.listenVisitor(current.id, (event) => {
      const { type, ...data } = event;
      sse.send(type, data);
    });
    await new Promise<void>((resolve) =>
      sse.closed.signal.addEventListener('abort', () => resolve()),
    );
    stop();
    sse.end();
  }

  // ── the website widget (chunk 13) ─────────────────────────────────────

  /**
   * What the widget's loader needs to draw the bubble. Stage 7: the widget may load on any site
   * (chatting still needs sign-in), and every site it loads on is noted for the owner's "Sites it
   * has loaded on" list. `key` is the page's address or its legacy slug, so old embeds keep working.
   */
  async widgetConfig(
    key: string,
    origin: string | undefined,
    req: Request,
  ): Promise<WidgetConfig> {
    const available = await this.page(key);
    await this.ipLimit(req, 'widget', BOT_PAGE_IP_LIMITS.widget.perHour);
    if (!origin || !this.hostOk(available, origin)) {
      throw publicError(HttpStatus.FORBIDDEN, 'host_not_allowed');
    }
    if (new URL(origin).origin !== this.config.botPage.origin) {
      void this.widgetSites?.record(available.chatbot.id, origin);
    }
    const { settings } = available;
    return {
      position: settings.widget.position,
      label: settings.widget.label,
      autoOpenSeconds: settings.widget.autoOpenSeconds,
      showOnPhones: settings.widget.showOnPhones,
      accent: settings.branding.accentColour,
      logo: available.brandImages?.logo?.src ?? settings.branding.logoUrl,
      title: settings.branding.title,
      pageUrl: this.pages.link(available.page.publicId),
    };
  }

  /**
   * The `frame-ancestors` the embedded page should be served with, for CloudFront and Caddy to set
   * (LAUNCH-CHECKLIST). Stage 7: any site may frame it (the widget loads anywhere; chatting still
   * needs sign-in). The page must still exist, so an unknown key stays a 404.
   */
  async framePolicy(key: string): Promise<{ frameAncestors: string }> {
    await this.page(key);
    return { frameAncestors: 'frame-ancestors *' };
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  /**
   * In the website widget: the host page the frame reported (the browser's own ancestor origin or
   * referrer, never the loader's say-so), if it is one of the bot's allowed websites or Ally's own
   * page. Null outside the widget. Refused with 403 `host_not_allowed` otherwise.
   */
  private embedOf(
    available: AvailableBotPage,
    req: Request,
    dto: BotPageEmbedDto | undefined,
  ): BotPageVisitor['embed'] {
    if (!BotPageVisitorService.isEmbed(req)) return null;
    if (!dto?.host || !this.hostOk(available, dto.host)) {
      throw publicError(HttpStatus.FORBIDDEN, 'host_not_allowed');
    }
    const host = new URL(dto.host).origin;
    return { host, page: cleanPageUrl(dto.page, host) };
  }

  /**
   * Whether the widget may open on this host. Stage 7: any http(s) page. The stored
   * `allowedDomains` are kept but no longer consulted.
   */
  private hostOk(_available: AvailableBotPage, host: string): boolean {
    return widgetSiteHost(host) !== null;
  }

  /** The free keyword crisis check (R1), for the limiter's exemption. Never throws. */
  private async crisisKeyword(
    text: string,
    chatbotId: string,
  ): Promise<boolean> {
    try {
      return Boolean(await this.engine.isCrisisKeyword(text, null, chatbotId));
    } catch {
      return false;
    }
  }

  /** The visitor behind the cookie, if they may use the page now; otherwise 401 or 403. */
  private async requireReady(
    available: AvailableBotPage,
    req: Request,
    // Stage 6: on a message, a verified visitor taken off the list gets the fixed notification
    // (with the crisis information) rather than an error screen. They proved the address
    // already, so this tells them nothing they did not know.
    { removedCode = 'not_allowed' }: { removedCode?: PublicErrorCode } = {},
  ): Promise<ReadyVisitor> {
    const visitor = await this.visitors.read(req, available.chatbot.id);
    if (!visitor) throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    // In the widget: the site it was opened on must still be allowed, so removing a website takes
    // effect at once, like removing a person.
    if (visitor.embed && !this.hostOk(available, visitor.embed.host)) {
      throw publicError(HttpStatus.FORBIDDEN, 'host_not_allowed');
    }
    if (available.page.access === BotPageAccess.PUBLIC) {
      return { visitor, email: null, eligibility: { eligible: true } };
    }
    if (!visitor.verifiedAt) {
      throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    }
    const ready = await this.recheck(available, visitor);
    if (!ready) throw publicError(HttpStatus.FORBIDDEN, removedCode);
    return ready;
  }

  /**
   * Whether a verified visitor may still use an organisation or invite page: their email is still
   * invited, or still an active user of an allowed organisation. Checked on every request, so taking
   * someone off the list takes effect at once.
   */
  private async recheck(
    available: AvailableBotPage,
    visitor: BotPageVisitor,
  ): Promise<ReadyVisitor | null> {
    const contact = await this.conversations.contactByIdentity(
      { chatbotId: available.chatbot.id },
      ConversationChannel.WEB,
      visitor.id,
    );
    if (!contact) return null;
    const identity = await this.conversations.identityOf(
      contact.id,
      ConversationChannel.EMAIL,
    );
    if (!identity?.verified) return null;
    const eligibility = await this.pageAccess.eligibility(
      available.page,
      identity.externalId,
    );
    return eligibility.eligible
      ? { visitor, email: identity.externalId, eligibility }
      : null;
  }

  private async sessionFor(
    available: AvailableBotPage,
    ready: ReadyVisitor,
  ): Promise<PublicSession> {
    // Asked once per person when there are any questions, optional ones included; only the
    // required ones block a message (`admit`).
    let intakeDone = available.settings.prechat.length === 0;
    if (!intakeDone) {
      const contact = await this.contactOf(available, ready, false);
      intakeDone = Boolean(contact && (await this.latestIntake(contact.id)));
    }
    return {
      state: 'ready',
      intakeDone,
      signedInAs: ready.email ? maskEmail(ready.email) : null,
    };
  }

  private async contactOf(
    available: AvailableBotPage,
    ready: ReadyVisitor,
    create: boolean,
  ): Promise<ChatbotContact | null> {
    const scope = { chatbotId: available.chatbot.id };
    if (create) {
      return this.conversations.resolveContact(
        scope,
        ConversationChannel.WEB,
        ready.visitor.id,
      );
    }
    return this.conversations.contactByIdentity(
      scope,
      ConversationChannel.WEB,
      ready.visitor.id,
    );
  }

  /**
   * The open thread, or a new one. A new thread ("New chat", or the idle window passed) carries the
   * contact's latest pre-chat answers over, so the questions are asked once per person, not once
   * per thread.
   */
  private async openWithIntake(
    available: AvailableBotPage,
    contact: ChatbotContact,
    ready: ReadyVisitor,
  ): Promise<ChatbotConversation> {
    const conversation = await this.conversations.openConversation(
      available.chatbot.id,
      contact.id,
      ConversationChannel.WEB,
      { idleWindowMinutes: available.botSettings.conversationIdleMinutes },
    );
    const source = sourceOf(ready, conversation);
    if (source.source) {
      await this.conversations.setMetadata(conversation.id, source);
    }
    if (!conversation.metadata?.intake) {
      const previous = await this.latestIntake(contact.id);
      if (previous) {
        await this.conversations.setMetadata(conversation.id, {
          intake: previous,
        });
      }
    }
    return conversation;
  }

  private latestIntake(contactId: string): Promise<StoredIntake | null> {
    return this.conversations.latestMetadata(
      contactId,
      ConversationChannel.WEB,
      'intake',
    ) as Promise<StoredIntake | null>;
  }

  private async fileUnanswered(
    messageId: string,
    conversationId: string,
    question: string,
    decision: ChatbotDecision,
  ): Promise<void> {
    const gap = decision.unanswered!;
    try {
      await this.unansweredRepository
        .createQueryBuilder()
        .insert()
        .into(WaUnansweredQuestion)
        .values({
          messageId,
          conversationId,
          questionText: question,
          language: decision.language ?? null,
          reason: gap.reason,
          topSimilarity:
            gap.topSimilarity === null
              ? null
              : String(gap.topSimilarity.toFixed(4)),
          hitCount: gap.hitCount,
        })
        .orIgnore()
        .execute();
    } catch (error) {
      // The reply already went out; a bookkeeping row never fails it (as on WhatsApp).
      this.logger.error(
        `Could not record an unanswered bot page question: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async ipLimit(
    req: Request,
    route: string,
    perHour: number,
  ): Promise<void> {
    const ip = req.ip || 'unknown';
    const tag = createHmac(
      'sha256',
      this.config.jwt.accessToken.secret || 'bot-page',
    )
      .update(`bot-page-ip:${ip}`)
      .digest('hex')
      .slice(0, 32);
    const result = await this.limits.hourly(`ip:${route}:${tag}`, perHour);
    if (!result.allowed) {
      throw publicError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}

/** The widget's token in the session answer, only when its cookie check failed and it asked. */
function withToken(
  req: Request,
  issued: IssuedVisitor,
  session: PublicSession,
): PublicSession {
  return issued.embed && req.headers[EMBED_TOKEN_HEADER] === '1'
    ? { ...session, visitorToken: issued.token }
    : session;
}

/** A chat started in the website widget is marked so the inbox can show "Website" (chunk 13). */
function sourceOf(
  ready: ReadyVisitor,
  conversation: ChatbotConversation,
): { source?: { kind: 'widget'; host: string; page: string | null } } {
  const embed = ready.visitor.embed;
  if (!embed || conversation.metadata?.source) return {};
  return { source: { kind: 'widget', host: embed.host, page: embed.page } };
}

/** Sources a visitor may see: the document's title and its public link, once each. */
export function publicCitations(
  citations: Record<string, unknown>[] | null | undefined,
): PublicCitation[] {
  const seen = new Set<string>();
  const out: PublicCitation[] = [];
  for (const citation of citations ?? []) {
    // A list record (chunk 6) reads "Slots · Thu 13 Nov, 11:15": the list, then the record.
    const name = String(citation.document_title ?? citation.title ?? '').trim();
    const section = String(citation.section_path ?? '').trim();
    const title =
      citation.record_id && name && section ? `${name} · ${section}` : name;
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const url = String(citation.source_url ?? '');
    out.push({ title, url: /^https?:\/\//.test(url) ? url : null });
  }
  return out;
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
