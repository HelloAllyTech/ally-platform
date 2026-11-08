import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';
import {
  BotPageIntakeDto,
  BotPageSessionDto,
  BotPageVerifyDto,
} from '../dto/bot-page.dto';
import { isFallback } from '../engine/agent-runtime';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import type {
  ChatbotDecision,
  ChatChannel,
  LiveReply,
} from '../engine/chatbot-engine.types';
import { ChatbotContact } from '../entity/chatbot-contact.entity';
import { ChatbotConversation } from '../entity/chatbot-conversation.entity';
import { BotPageAccess } from '../enum/bot-page.enum';
import { ChatbotAccessMode } from '../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import { ConversationService } from '../service/conversation.service';
import {
  AGENT_FALLBACK_EVENT,
  AgentFallbackEvent,
} from '../type/agent-runtime.event';
import { BOT_PAGE_BOUNDS, PrechatField } from '../type/bot-page.type';
import {
  BotPageAccessService,
  BotPageEligibility,
} from './bot-page-access.service';
import {
  IntakeError,
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
} from './bot-page-visitor.service';
import { TurnstileService } from './turnstile.service';

/** What a visitor's browser learns about a page. Nothing internal: no prompts, ids or settings. */
export interface PublicBotPage {
  slug: string;
  access: BotPageAccess;
  /** The words, plus `look` (chunk 20d): heading style, theme, the corrected accent and images. */
  branding: AvailableBotPage['settings']['branding'] & {
    look: PublicBrandLook;
  };
  suggestedQuestions: string[];
  prechat: PrechatField[];
  maxMessageChars: number;
  language: AvailableBotPage['settings']['language'];
  /** Set when the page needs a Turnstile token to start a session. */
  turnstileSiteKey: string | null;
}

/** How the page looks to a visitor. Image URLs are on the public image route; no ids. */
export interface PublicBrandLook {
  headingStyle: AvailableBotPage['settings']['brand']['headingStyle'];
  theme: AvailableBotPage['settings']['brand']['theme'];
  accent: string;
  logo: AvailableBotPage['brandImages']['logo'];
  cover: AvailableBotPage['brandImages']['cover'];
}

export type SessionState = 'ready' | 'needs_email' | 'needs_code';

export interface PublicSession {
  state: SessionState;
  /** Whether the pre-chat questions still have to be answered before the first message. */
  intakeDone: boolean;
  /** The masked email the visitor verified, for "Signed in as a***@example.com". */
  signedInAs: string | null;
}

/** A source under an answer: what it's called, and a link when the document has one. */
export interface PublicCitation {
  title: string;
  url: string | null;
}

export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations: PublicCitation[];
  createdAt: string;
}

/** The stream's `final`: the reply as stored, never the run behind it. */
export interface PublicFinal {
  reply: string;
  citations: PublicCitation[];
  messageId: string;
  conversationId: string;
}

/** The bot page's refusals, mapped onto the repo's `ErrorCode` contract (see error-code.enum.ts). */
const PUBLIC_ERRORS = {
  not_found: ErrorCode.BOT_PAGE_NOT_FOUND,
  bot_check_failed: ErrorCode.BOT_PAGE_BOT_CHECK_FAILED,
  start_again: ErrorCode.BOT_PAGE_START_AGAIN,
  not_allowed: ErrorCode.BOT_PAGE_NOT_ALLOWED,
  code_wrong: ErrorCode.BOT_PAGE_CODE_WRONG,
  code_expired: ErrorCode.BOT_PAGE_CODE_EXPIRED,
  code_too_many: ErrorCode.BOT_PAGE_CODE_TOO_MANY,
  email_failed: ErrorCode.BOT_PAGE_EMAIL_UNAVAILABLE,
  rate_limited: ErrorCode.BOT_PAGE_THROTTLED,
  busy: ErrorCode.BOT_PAGE_BUSY_UNAVAILABLE,
  too_long: ErrorCode.BOT_PAGE_MESSAGE_TOO_LONG,
  intake_required: ErrorCode.BOT_PAGE_INTAKE_REQUIRED,
  intake_invalid: ErrorCode.BOT_PAGE_INTAKE_INVALID,
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
    @InjectRepository(WaUnansweredQuestion)
    private readonly unansweredRepository: Repository<WaUnansweredQuestion>,
  ) {}

  async page(slug: string): Promise<AvailableBotPage> {
    const available = await this.pages.findAvailable(slug);
    if (!available) throw publicError(HttpStatus.NOT_FOUND, 'not_found');
    return available;
  }

  view(available: AvailableBotPage): PublicBotPage {
    const { page, settings } = available;
    return {
      slug: page.slug,
      access: page.access,
      branding: {
        ...settings.branding,
        look: {
          headingStyle: settings.brand.headingStyle,
          theme: settings.brand.theme,
          accent: settings.branding.accentColour,
          logo: available.brandImages?.logo ?? null,
          cover: available.brandImages?.cover ?? null,
        },
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
    };
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
    let visitor = await this.visitors.read(req, chatbot.id);

    if (page.access === BotPageAccess.PUBLIC) {
      if (!visitor) {
        if (!(await this.turnstile.verify(dto.turnstileToken, req.ip))) {
          throw publicError(HttpStatus.FORBIDDEN, 'bot_check_failed');
        }
        visitor = this.visitors.newVisitor(chatbot.id);
      }
      visitor = await this.visitors.issue(res, visitor);
      return this.sessionFor(available, {
        visitor,
        email: null,
        eligibility: { eligible: true },
      });
    }

    // Organisation and invite pages: a visitor who proved an email recently, and still may, is in.
    if (visitor?.verifiedAt) {
      const ready = await this.recheck(available, visitor);
      if (ready) {
        await this.visitors.issue(res, visitor);
        return this.sessionFor(available, ready);
      }
    }

    if (!dto.email) {
      return { state: 'needs_email', intakeDone: false, signedInAs: null };
    }
    const email = BotPageAccessService.tryNormaliseEmail(dto.email);
    if (!email) throw publicError(HttpStatus.BAD_REQUEST, 'not_allowed');

    if (!visitor) visitor = this.visitors.newVisitor(chatbot.id);
    // A new code for an address the visitor typed: whatever they had proved before no longer counts.
    await this.visitors.issue(res, { ...visitor, verifiedAt: null });

    const eligibility = await this.pageAccess.eligibility(page, email);
    if (eligibility.eligible) {
      const sent = await this.otp.send(chatbot.id, email, {
        title: available.settings.branding.title,
        logoUrl: available.settings.branding.logoUrl,
        accentColour: available.settings.branding.accentColour,
      });
      if (sent === 'too_many') {
        throw publicError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited');
      }
      if (sent === 'failed') {
        throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'email_failed');
      }
    }
    // The same answer whether or not the address may use the page, so the page can't be used to
    // find out who is invited.
    return { state: 'needs_code', intakeDone: false, signedInAs: null };
  }

  async verify(
    slug: string,
    dto: BotPageVerifyDto,
    req: Request,
    res: Response,
  ): Promise<PublicSession> {
    const available = await this.page(slug);
    await this.ipLimit(req, 'verify', BOT_PAGE_IP_LIMITS.verify.perHour);
    const visitor = await this.visitors.read(req, available.chatbot.id);
    if (!visitor || available.page.access === BotPageAccess.PUBLIC) {
      throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    }
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
    return this.sessionFor(available, {
      visitor: verified,
      email,
      eligibility,
    });
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
    await this.conversations.setMetadata(conversation.id, { intake });
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
            row.role === ConversationMessageRole.USER ? 'user' : 'assistant',
          text: row.text,
          citations: publicCitations(row.citations),
          createdAt: row.createdAt.toISOString(),
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
   * with a `code`, so the page can explain them.
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
    const ready = await this.requireReady(available, req);
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
    const perVisitor = await this.limits.hourly(
      `v:${available.chatbot.id}:${ready.visitor.id}`,
      available.settings.limits.messagesPerVisitorPerHour,
    );
    if (!perVisitor.allowed) {
      throw publicError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', {
        retryAfterSeconds: perVisitor.retryAfterSeconds,
      });
    }

    if (intakeRequired(available.settings.prechat)) {
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

    const cap = await this.limits.dailyCap(
      available.chatbot.id,
      available.settings.limits.dailyCapPerBot,
    );
    if (!cap.allowed) throw publicError(HttpStatus.SERVICE_UNAVAILABLE, 'busy');

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
    },
    live?: LiveReply,
  ): Promise<PublicFinal> {
    const { available, ready, text } = admitted;
    const { chatbot, botSettings } = available;
    const contact = (await this.contactOf(available, ready, true))!;
    const conversation = await this.openWithIntake(available, contact);

    const inbound = await this.conversations.appendMessage(conversation.id, {
      channel: ConversationChannel.WEB,
      direction: WaMessageDirection.INBOUND,
      role: ConversationMessageRole.USER,
      text,
      status: WaMessageStatus.PROCESSING,
    });

    const startedAt = Date.now();
    let decision: ChatbotDecision;
    try {
      const history = await this.conversations.recentHistory(conversation.id);
      decision = await this.engine.respond(
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
        },
        live,
      );
    } catch (error) {
      await this.conversations.updateMessage(inbound.id, {
        status: WaMessageStatus.FAILED,
        errorMessage:
          error instanceof Error ? error.message : 'unknown failure',
      });
      throw error;
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

    if (decision.unanswered) {
      await this.fileUnanswered(inbound.id, conversation.id, text, decision);
    }
    if (decision.alert) this.eventEmitter.emit('exception', decision.alert);
    if (isFallback(decision.agent)) {
      this.eventEmitter.emit(AGENT_FALLBACK_EVENT, {
        chatbot: { id: chatbot.id, name: chatbot.name },
        reason: decision.agent.fallbackReason,
      } satisfies AgentFallbackEvent);
    }

    return {
      reply: decision.body,
      citations: publicCitations(decision.citations),
      messageId: outbound.id,
      conversationId: conversation.id,
    };
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  /** The visitor behind the cookie, if they may use the page now; otherwise 401 or 403. */
  private async requireReady(
    available: AvailableBotPage,
    req: Request,
  ): Promise<ReadyVisitor> {
    const visitor = await this.visitors.read(req, available.chatbot.id);
    if (!visitor) throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    if (available.page.access === BotPageAccess.PUBLIC) {
      return { visitor, email: null, eligibility: { eligible: true } };
    }
    if (!visitor.verifiedAt) {
      throw publicError(HttpStatus.UNAUTHORIZED, 'start_again');
    }
    const ready = await this.recheck(available, visitor);
    if (!ready) throw publicError(HttpStatus.FORBIDDEN, 'not_allowed');
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
  ): Promise<ChatbotConversation> {
    const conversation = await this.conversations.openConversation(
      available.chatbot.id,
      contact.id,
      ConversationChannel.WEB,
      { idleWindowMinutes: available.botSettings.conversationIdleMinutes },
    );
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

/** Sources a visitor may see: the document's title and its public link, once each. */
export function publicCitations(
  citations: Record<string, unknown>[] | null | undefined,
): PublicCitation[] {
  const seen = new Set<string>();
  const out: PublicCitation[] = [];
  for (const citation of citations ?? []) {
    const title = String(
      citation.document_title ?? citation.title ?? '',
    ).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const url = String(citation.source_url ?? '');
    out.push({ title, url: /^https?:\/\//.test(url) ? url : null });
  }
  return out;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
