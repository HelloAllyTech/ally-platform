import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsNull, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { NotificationErrorType } from 'src/notification/type/notification.error.type';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../entity/wa-unanswered-question.entity';
import {
  WaConsentStatus,
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
  WaTemplateKind,
  WaUnansweredReason,
} from '../enum/whatsapp.enum';
import { InboundWhatsAppMessage } from '../type/whatsapp-provider.interface';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import { WhatsAppBotSettings } from '../type/whatsapp-settings.type';
import { WhatsAppBusinessNumberService } from './whatsapp-business-number.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import { WhatsAppRateLimitService } from './whatsapp-rate-limit.service';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import {
  AGENT_FALLBACK_EVENT,
  AGENT_SHADOW_RUN_EVENT,
  type AgentFallbackEvent,
  type AgentShadowRunEvent,
  isFallback,
} from 'src/chatbot/engine/agent-runtime';
import type { AgentRunRef } from 'src/chatbot/engine/chatbot-engine.types';
import { ChatbotStatus } from 'src/chatbot/enum/chatbot.enum';
import { ChatbotEngineService } from 'src/chatbot/engine/chatbot-engine.service';
import { ConnectorService } from 'src/chatbot/service/connector.service';
import { withFirstMessageParts } from 'src/chatbot/engine/first-reply';
import { MAX_HISTORY_MESSAGES } from 'src/chatbot/engine/knowledge-request';

/**
 * Opt-out / opt-in words, recognised in code regardless of what templates exist.
 *
 * Hard-coded rather than left to a template because opting out is a compliance obligation, and it
 * must keep working even if an admin deletes or breaks the consent template.
 */
const OPT_OUT_WORDS = new Set(['stop', 'unsubscribe', 'cancel', 'quit']);
const OPT_IN_WORDS = new Set(['start', 'subscribe', 'resume']);

/**
 * Send-retry budget for `reply()`.
 *
 * TWO attempts, not three, and the number is derived rather than picked. The inbound consumer's SQS
 * visibility window is 60s; retrieval before the send may already have spent up to ~25s; the
 * provider's own HTTP timeout is 15s. Two attempts plus one 500ms pause is ~30.5s of send worst
 * case, which fits alongside retrieval with room to spare. A third would not.
 *
 * A retry here is safe from the double-reply hazard the class invariant guards against: the retry
 * happens INSIDE one `reply()` call against one already-persisted outbound row, so it cannot produce
 * a second row, and nothing is rethrown, so SQS is never asked to redeliver.
 */
const SEND_MAX_ATTEMPTS = 2;
const SEND_RETRY_DELAY_MS = 500;
/**
 * Only retry a failure that came back FAST. A send that burned most of the provider's 15s timeout
 * indicates a provider under strain, and a second full-length attempt would risk the visibility
 * window to buy very little. The failures a retry genuinely fixes — connection reset, a 502 from
 * Meta's edge, a DNS blip — return in well under a second.
 */
const SEND_RETRY_MAX_ATTEMPT_MS = 5_000;

/**
 * Is a provider send failure worth another attempt?
 *
 * Anything Meta answered with a 4xx is terminal: an invalid number, a closed 24-hour
 * customer-service window and a rejected template are all refused identically on a second try, and
 * retrying spends the visibility budget to reach the same conclusion. A 5xx, a timeout, or no
 * response at all is transient.
 */
function isRetryableSendFailure(error: unknown): boolean {
  const status = (
    error as { response?: { status?: number }; status?: number } | undefined
  )?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    // 429 is the exception among 4xx — it explicitly means "later", not "never".
    return status === 429;
  }
  return true;
}

/**
 * Processes one inbound WhatsApp message end to end — the WhatsApp connector's half. Which reply
 * to give is the chatbot engine's decision (ChatbotEngineService); everything that is about
 * WhatsApp itself happens here, around it.
 *
 * The ORDER of the steps below is the design. Each one exists because of a specific way the pipeline
 * would otherwise misbehave, and moving any of them breaks that guarantee:
 *
 *   0. bot           — the chatbot the number's connector is bound to; none, no reply.
 *   1. dedupe        — first write, always. SQS is at-least-once AND Meta retries independently.
 *   2. kill switch   — before anything costs money: the platform switch, and the bot being live.
 *   3. contact       — resolves consent and block state.
 *   4. rate limit    — after dedupe, so a redelivery never consumes budget.
 *   5. consent gate  — before the LLM, so a first-time worker sees the disclaimer.
 *   6. identity      — who is asking, for the bot's "who can chat" list and per-organisation
 *                      knowledge.
 *   7. decide        — the engine: keyword replies first (so a crisis reply never depends on a
 *                      model call), then the access gate (with the crisis classifier BEFORE any
 *                      refusal), then the answer, concurrent with the crisis classifier.
 *   8. send          — persisted as `queued` BEFORE the send, so a crash is visible.
 *
 * THE ONE INVARIANT: this service throws only BEFORE it has sent anything. After a send it records
 * the failure and returns normally. Throwing after a send guarantees an SQS redelivery that answers
 * the same worker twice, which is the worst failure this pipeline has.
 */
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppInboundService.name,
  );

  constructor(
    @InjectRepository(WaContact)
    private readonly contactRepository: Repository<WaContact>,
    @InjectRepository(WaConversation)
    private readonly conversationRepository: Repository<WaConversation>,
    @InjectRepository(WaMessage)
    private readonly messageRepository: Repository<WaMessage>,
    @InjectRepository(WaUnansweredQuestion)
    private readonly unansweredRepository: Repository<WaUnansweredQuestion>,
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly settingsService: ChatbotSettingsService,
    private readonly templateService: ChatbotReplyService,
    private readonly rateLimitService: WhatsAppRateLimitService,
    private readonly identityService: WhatsAppIdentityService,
    private readonly numberService: WhatsAppBusinessNumberService,
    private readonly connectorService: ConnectorService,
    private readonly engine: ChatbotEngineService,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handle(inbound: InboundWhatsAppMessage): Promise<void> {
    // Which number the worker wrote to decides whose bot this is: the settings, the organisation
    // whose documents answer, and the credentials the reply goes out with. A number disconnected
    // while its message sat in the queue is dropped — there are no credentials left to reply with.
    const number = await this.numberService.resolveForInbound(
      inbound.phoneNumberId,
    );
    if (!number) {
      this.logger.warn(
        `Dropping message ${inbound.providerMessageId}: phone number id ` +
          `${inbound.phoneNumberId} is not connected`,
      );
      return;
    }
    // Which bot answers: the one the number's connector is bound to, or for the env-configured
    // platform number the platform chatbot. A number bound to no bot is not answered — and not
    // recorded, since there is no bot whose conversations it would belong to.
    const chatbot = number.connectorId
      ? await this.connectorService.chatbotFor(number.connectorId)
      : await this.platformChatbot();
    if (!chatbot) {
      this.logger.warn(
        `Dropping message ${inbound.providerMessageId}: the number is not bound to a chatbot`,
      );
      return;
    }
    const settings = await this.settingsService.getForChatbot(chatbot);

    // ── 1. Dedupe ──────────────────────────────────────────────────────────
    // First statement, unconditionally. ON CONFLICT DO NOTHING against the unique index on
    // provider_message_id is the only reliable guard: SQS may redeliver and Meta may retry, and the
    // two are independent, so no in-memory or lock-based scheme covers both.
    const inserted = await this.messageRepository
      .createQueryBuilder()
      .insert()
      .into(WaMessage)
      .values({
        // A placeholder conversation is impossible before we know the contact, so the row is
        // inserted with the ids filled in immediately afterwards. The INSERT exists to claim the
        // provider id, which is the part that must be atomic.
        conversationId: '00000000-0000-0000-0000-000000000000',
        contactId: '00000000-0000-0000-0000-000000000000',
        direction: WaMessageDirection.INBOUND,
        providerMessageId: inbound.providerMessageId,
        body: inbound.text,
        status: WaMessageStatus.RECEIVED,
      })
      .orIgnore()
      .returning('id')
      .execute();

    const inboundId: string | undefined = inserted.raw?.[0]?.id;
    if (!inboundId) {
      this.logger.info(
        `Skipping already-handled message ${inbound.providerMessageId}`,
      );
      return;
    }

    const startedAt = Date.now();

    try {
      // ── 2. Kill switch ───────────────────────────────────────────────────
      if (!settings.enabled) {
        await this.discard(inboundId, 'the bot is disabled');
        return;
      }
      if (chatbot.status !== ChatbotStatus.LIVE) {
        await this.discard(inboundId, `the chatbot is ${chatbot.status}`);
        return;
      }

      // ── 3. Contact ───────────────────────────────────────────────────────
      const contact = await this.resolveContact(inbound, number.id);
      const conversation = await this.resolveConversation(
        contact,
        settings,
        chatbot.id,
        number.connectorId,
      );
      await this.messageRepository.update(
        { id: inboundId },
        {
          contactId: contact.id,
          conversationId: conversation.id,
          status: WaMessageStatus.PROCESSING,
        },
      );

      if (contact.blockedAt) {
        // Silently. Telling an abuser precisely when they were blocked mostly teaches them to
        // switch numbers.
        await this.discard(inboundId, 'the contact is blocked');
        return;
      }

      // Media has no text to answer, and this check comes before the rate limit so a worker sending
      // a photo is told why rather than being counted against their budget.
      if (inbound.isUnsupportedMedia || !inbound.text.trim()) {
        await this.reply(
          contact,
          conversation,
          inboundId,
          settings.unsupportedMediaText,
          WaHandledBy.UNSUPPORTED_MEDIA,
          startedAt,
        );
        return;
      }

      // ── 4. Rate limit ────────────────────────────────────────────────────
      // Keyed per (number, sender): a worker's budget on one organisation's bot is not spent by
      // their questions to another's. The platform number keeps its original keys.
      const rateKey = number.id
        ? `${number.id}:${contact.phoneE164}`
        : contact.phoneE164;
      const limit = await this.rateLimitService.check(rateKey, settings);
      if (!limit.allowed) {
        const notify = await this.rateLimitService.shouldNotify(
          rateKey,
          limit.window ?? 'minute',
        );
        if (notify) {
          await this.reply(
            contact,
            conversation,
            inboundId,
            settings.rateLimitText,
            WaHandledBy.RATE_LIMITED,
            startedAt,
          );
        } else {
          await this.discard(inboundId, 'rate limited (already notified)');
        }
        return;
      }

      // ── 5. Consent / opt-out ─────────────────────────────────────────────
      const consentHandled = await this.handleConsent(
        contact,
        conversation,
        inboundId,
        inbound.text,
        settings,
        startedAt,
        chatbot.id,
      );
      if (consentHandled) return;

      // Every path from here replies — a keyword reply at once, the others after a model call.
      // Placed HERE and no earlier because Meta's guidance is to show typing only when a reply is
      // coming: the silent exits above (opted out, blocked, rate-limited) must not leave a bubble
      // that never resolves. Not awaited; the catch covers any implementation that rejects.
      void this.provider
        .showTypingIndicator?.(inbound.providerMessageId, number.creds)
        ?.catch(() => undefined);

      // ── 6. Identity ──────────────────────────────────────────────────────
      // Who is asking, for the bot's "who can chat" list and per-organisation knowledge.
      // Re-resolved on every message, so a number mapped after someone first wrote starts working
      // on their next question.
      // A lookup failure counts as "not recognised" rather than failing the message: the keyword
      // replies the engine runs next — crisis above all — must never depend on knowing who asked.
      const identified = await this.identityService
        .identify(contact, null)
        .catch((error: unknown) => {
          this.logger.warn(
            `Identity lookup failed for contact ending ${contact.phoneLast4}; treated as ` +
              `unrecognised: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          return { ...contact, userId: null, tenantId: null } as WaContact;
        });

      // ── 7. The bot decides ───────────────────────────────────────────────
      const decision = await this.engine.respond({
        chatbot,
        settings,
        text: inbound.text,
        language: contact.locale,
        history: await this.recentHistory(conversation.id),
        isFirstMessage: contact.messageCount === 1,
        sender: {
          externalId: contact.phoneE164,
          label: `contact ending ${contact.phoneLast4}`,
          phone: contact.phoneE164,
          userId: identified.userId ?? null,
          tenantId: identified.tenantId ?? null,
        },
        channel: { type: 'whatsapp', capabilities: { maxReplyChars: 4096 } },
        // The Agents v2 run's thread and the message its run id is derived from.
        conversationId: conversation.id,
        providerMessageId: inbound.providerMessageId,
      });

      // ── 8. Send and record ───────────────────────────────────────────────
      // A person's first hello also gets the first-message notice after the welcome message.
      const body =
        contact.messageCount === 1
          ? withFirstMessageParts({
              body: decision.body,
              handledBy: decision.handledBy,
              bodyIsWelcome: decision.isWelcome,
              notice: this.settingsService.renderPlaceholders(
                settings.disclaimerText ?? '',
                settings,
              ),
            })
          : decision.body;
      if (decision.language) {
        await this.contactRepository.update(
          { id: contact.id },
          { locale: decision.language },
        );
        await this.conversationRepository.update(
          { id: conversation.id },
          { lastLanguage: decision.language },
        );
      }
      await this.reply(
        identified,
        conversation,
        inboundId,
        body,
        decision.handledBy,
        startedAt,
        {
          templateId: decision.templateId,
          citations: decision.citations,
          retrievalMeta: decision.retrievalMeta,
          language: decision.language ?? undefined,
          agent: decision.agent,
        },
      );
      if (decision.unanswered) {
        await this.recordUnanswered(
          inboundId,
          conversation.id,
          inbound.text,
          decision.language ?? contact.locale,
          decision.unanswered.reason,
          decision.unanswered.topSimilarity,
          decision.unanswered.hitCount,
        );
      }
      if (decision.alert) this.eventEmitter.emit('exception', decision.alert);
      // Agents v2. The fallback alert is throttled per bot and reason by its listener
      // (AgentRuntimeAlertThrottle), so it is announced here rather than emitted as an alert.
      if (isFallback(decision.agent)) {
        this.eventEmitter.emit(AGENT_FALLBACK_EVENT, {
          chatbot: { id: chatbot.id, name: chatbot.name },
          reason: decision.agent.fallbackReason,
        } satisfies AgentFallbackEvent);
      }
      // Only now — the reply has been sent and recorded. Its listener (ChatbotShadowService) runs
      // asynchronously and never throws, so a shadow run cannot delay this message, fail it, or
      // have it redelivered.
      if (decision.shadow) {
        this.eventEmitter.emit(AGENT_SHADOW_RUN_EVENT, {
          chatbotId: chatbot.id,
          conversationId: conversation.id,
          inboundMessageId: inboundId,
          shadow: decision.shadow,
        } satisfies AgentShadowRunEvent);
      }
    } catch (error) {
      // Reached only when nothing has been sent — every send path above returns. Recorded on the
      // message and swallowed: rethrowing would redeliver and risk a second reply.
      const message =
        error instanceof Error ? error.message : 'unknown failure';
      this.logger.error(`WhatsApp inbound processing failed: ${message}`);
      await this.messageRepository.update(
        { id: inboundId },
        { status: WaMessageStatus.FAILED, errorMessage: message },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────── consent

  /**
   * Handle STOP / START and the first-contact disclaimer.
   *
   * Returns true when this step produced the reply.
   *
   * The disclaimer is PREFIXED onto the answer to the worker's real question rather than sent as a
   * standalone message. A bare disclaimer reads as a bot that ignored you, and it costs the worker a
   * round trip to ask again.
   */
  private async handleConsent(
    contact: WaContact,
    conversation: WaConversation,
    inboundId: string,
    text: string,
    settings: WhatsAppBotSettings,
    startedAt: number,
    chatbotId: string,
  ): Promise<boolean> {
    const normalised = ChatbotReplyService.normalise(text);

    if (OPT_OUT_WORDS.has(normalised)) {
      await this.contactRepository.update(
        { id: contact.id },
        {
          consentStatus: WaConsentStatus.OPTED_OUT,
          optedOutAt: new Date(),
        },
      );
      const template = (
        await this.templateService.findByKind(WaTemplateKind.CONSENT, chatbotId)
      ).find((t) => t.patterns.some((p) => OPT_OUT_WORDS.has(p.toLowerCase())));
      await this.reply(
        contact,
        conversation,
        inboundId,
        this.settingsService.renderPlaceholders(
          template?.responseText ??
            'You will not receive any more messages. Reply START at any time to opt back in.',
          settings,
        ),
        WaHandledBy.CONSENT,
        startedAt,
        { templateId: template?.id },
      );
      return true;
    }

    if (contact.consentStatus === WaConsentStatus.OPTED_OUT) {
      if (OPT_IN_WORDS.has(normalised)) {
        await this.contactRepository.update(
          { id: contact.id },
          {
            consentStatus: WaConsentStatus.GRANTED,
            consentGrantedAt: new Date(),
            optedOutAt: null,
          },
        );
        await this.reply(
          contact,
          conversation,
          inboundId,
          this.settingsService.renderPlaceholders(
            settings.disclaimerText,
            settings,
          ),
          WaHandledBy.CONSENT,
          startedAt,
        );
        return true;
      }
      // Anything else from an opted-out number is dropped in silence. Replying at all — even
      // "you have opted out" — is a message they explicitly asked not to receive.
      await this.discard(inboundId, 'the contact has opted out');
      return true;
    }

    return false;
  }

  /**
   * The bot that answers the env-configured platform number, which has no connector: the
   * `platformChatbotId` in the default settings.
   */
  private async platformChatbot(): Promise<Chatbot | null> {
    const { platformChatbotId } = await this.settingsService.get();
    if (!platformChatbotId) return null;
    return this.chatbotRepository.findOne({
      where: { id: platformChatbotId, archivedAt: IsNull() },
    });
  }

  private async recentHistory(
    conversationId: string,
  ): Promise<{ role: string; content: string }[]> {
    const rows = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: MAX_HISTORY_MESSAGES,
      select: ['direction', 'body', 'createdAt'],
    });
    return rows
      .reverse()
      .map((row) => ({
        role:
          row.direction === WaMessageDirection.INBOUND ? 'user' : 'assistant',
        content: row.body,
      }))
      .filter((turn) => turn.content?.trim());
  }

  // ─────────────────────────────────────────────────────────────── plumbing

  private async resolveContact(
    inbound: InboundWhatsAppMessage,
    businessNumberId: string | null,
  ): Promise<WaContact> {
    const now = new Date();
    const existing = await this.contactRepository.findOne({
      where: {
        phoneE164: inbound.from,
        businessNumberId: businessNumberId ?? IsNull(),
      },
    });
    if (existing) {
      await this.contactRepository.update(
        { id: existing.id },
        { lastSeenAt: now, messageCount: existing.messageCount + 1 },
      );
      return { ...existing, messageCount: existing.messageCount + 1 };
    }

    return this.contactRepository.save(
      this.contactRepository.create({
        phoneE164: inbound.from,
        businessNumberId,
        phoneLast4: inbound.from.slice(-4),
        consentStatus: WaConsentStatus.PENDING,
        firstSeenAt: now,
        lastSeenAt: now,
        messageCount: 1,
      }),
    );
  }

  /**
   * Find the open thread or start a new one.
   *
   * WhatsApp has no session concept, so one is defined: `conversationIdleMinutes` of silence closes
   * the thread. Without it the RAG agent would eventually be handed a month-old exchange as context
   * for today's question, which is worse than no context.
   */
  private async resolveConversation(
    contact: WaContact,
    settings: WhatsAppBotSettings,
    chatbotId: string,
    connectorId: string | null,
  ): Promise<WaConversation> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - settings.conversationIdleMinutes * 60_000,
    );

    const open = await this.conversationRepository
      .createQueryBuilder('c')
      .where('c.contactId = :contactId', { contactId: contact.id })
      .andWhere('c.lastMessageAt >= :cutoff', { cutoff })
      // A thread belongs to the bot that started it: when a number moves to another bot, the
      // next message starts a fresh thread instead of handing the new bot the old one's history.
      .andWhere('c.chatbotId = :chatbotId', { chatbotId })
      .orderBy('c.lastMessageAt', 'DESC')
      .getOne();

    if (open) {
      await this.conversationRepository.update(
        { id: open.id },
        { lastMessageAt: now, messageCount: open.messageCount + 1 },
      );
      return open;
    }

    return this.conversationRepository.save(
      this.conversationRepository.create({
        contactId: contact.id,
        chatbotId,
        connectorId,
        startedAt: now,
        lastMessageAt: now,
        messageCount: 1,
      }),
    );
  }

  /**
   * Persist the outbound row, then send, then record the result.
   *
   * Persisted as `queued` BEFORE the send so a crash between the two is visible as a queued message
   * that never went out, rather than invisible. A send failure is recorded and swallowed — see the
   * class invariant.
   */
  private async reply(
    contact: WaContact,
    conversation: WaConversation,
    inReplyToId: string,
    body: string,
    handledBy: WaHandledBy,
    startedAt: number,
    extra: {
      templateId?: string;
      citations?: Record<string, any>[];
      retrievalMeta?: Record<string, any>;
      language?: string;
      /** The Agents v2 run behind this reply; v1 replies leave the run columns unset. */
      agent?: AgentRunRef;
    } = {},
  ): Promise<void> {
    const outbound = await this.messageRepository.save(
      this.messageRepository.create({
        conversationId: conversation.id,
        contactId: contact.id,
        direction: WaMessageDirection.OUTBOUND,
        body,
        handledBy,
        templateId: extra.templateId ?? null,
        citations: extra.citations ?? null,
        retrievalMeta: extra.retrievalMeta ?? null,
        language: extra.language ?? null,
        latencyMs: Date.now() - startedAt,
        status: WaMessageStatus.QUEUED,
        inReplyToId,
        ...(extra.agent
          ? {
              agentRunId: extra.agent.runId,
              agentRuntime: extra.agent.runtime,
            }
          : {}),
      }),
    );

    let sent = false;
    let lastReason = 'unknown error';

    // RETRY the send, then ALERT if it still fails. Neither existed before: a provider send failure
    // marked the row FAILED and returned, so the worker who asked a question — possibly a CRISIS
    // question, since the crisis paths reply through this same method — simply never heard back, and
    // nobody was told. The crisis branches emit an `exception` event when a crisis FIRES; the reply
    // that carries the safety number to the worker had no such coverage.
    //
    // Budget: SEND_MAX_ATTEMPTS × the provider's own 15s timeout + the pauses between them, which is
    // sized to stay inside the inbound consumer's 60s SQS visibility window alongside the retrieval
    // that ran before it. See SEND_MAX_ATTEMPTS.
    for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        const creds = await this.numberService.credentialsFor(
          contact.businessNumberId,
        );
        if (!creds) {
          throw new Error(
            "This organisation's WhatsApp number has been disconnected",
          );
        }
        const { providerMessageId } = await this.provider.sendText(
          contact.phoneE164,
          body,
          creds,
        );
        await this.messageRepository.update(
          { id: outbound.id },
          { providerMessageId, status: WaMessageStatus.SENT },
        );
        await this.messageRepository.update(
          { id: inReplyToId },
          { status: WaMessageStatus.SENT, handledBy },
        );
        if (attempt > 1) {
          this.logger.info(
            `WhatsApp send succeeded on attempt ${attempt}/${SEND_MAX_ATTEMPTS}`,
          );
        }
        sent = true;
        break;
      } catch (error) {
        lastReason = error instanceof Error ? error.message : 'unknown error';
        const attemptMs = Date.now() - attemptStartedAt;
        this.logger.error(
          `WhatsApp send failed (attempt ${attempt}/${SEND_MAX_ATTEMPTS}, ` +
            `${attemptMs}ms): ${lastReason}`,
        );

        if (attempt >= SEND_MAX_ATTEMPTS) break;

        // Only a TRANSIENT failure is worth a second attempt. A 4xx from Meta — an invalid number, a
        // closed 24-hour customer-service window, a template rejection — will be refused identically,
        // and retrying it spends the visibility window to arrive at the same place.
        if (!isRetryableSendFailure(error)) {
          this.logger.warn(
            'Not retrying the WhatsApp send — the provider rejected it terminally',
          );
          break;
        }
        // A slow failure means the provider is struggling; a second full-length request would risk
        // the visibility window for little gain. Fast failures (connection reset, 502) are the ones
        // a retry actually fixes.
        if (attemptMs > SEND_RETRY_MAX_ATTEMPT_MS) {
          this.logger.warn(
            `Not retrying the WhatsApp send — the failed attempt took ${attemptMs}ms, ` +
              `above the ${SEND_RETRY_MAX_ATTEMPT_MS}ms retry ceiling`,
          );
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, SEND_RETRY_DELAY_MS),
        );
      }
    }

    if (!sent) {
      await this.messageRepository.update(
        { id: outbound.id },
        { status: WaMessageStatus.FAILED, errorMessage: lastReason },
      );
      await this.messageRepository.update(
        { id: inReplyToId },
        { status: WaMessageStatus.FAILED, errorMessage: lastReason, handledBy },
      );

      // Routed to the same Slack path the crisis branches use. An undelivered reply is only ever
      // discoverable by querying wa_messages for FAILED rows, which is not something anyone does
      // unprompted. Escalated hardest when the undelivered reply was a CRISIS reply: that is a
      // worker in danger who was sent a safety number that never arrived, and it needs a human now.
      const isCrisisReply = handledBy === WaHandledBy.CRISIS;
      this.eventEmitter.emit('exception', {
        statusCode: 500,
        timestamp: new Date().toISOString(),
        path: 'whatsapp/send-failed',
        message:
          `${isCrisisReply ? 'A CRISIS reply' : 'A reply'} to a WhatsApp worker ` +
          `(contact ends ${contact.phoneLast4}) could not be delivered: ${lastReason}. ` +
          `Handled by ${handledBy}. Outbound message ${outbound.id}. ` +
          (isCrisisReply
            ? 'The worker was NOT given the escalation contact — reach them another way.'
            : 'The worker received no answer to their question.'),
        type: isCrisisReply
          ? 'WhatsApp Crisis Reply Undelivered'
          : 'WhatsApp Reply Undelivered',
      } as NotificationErrorType);
    }

    // Record consent on the first successful exchange, not before: a disclaimer that failed to send
    // has not been shown, and marking it granted would mean the worker never sees it.
    //
    // NOTE this predates the retry above and is unchanged in spirit, but it was already only
    // loosely honouring its own comment — it runs whether or not the send succeeded. Gated on `sent`
    // now, which is what the comment says.
    if (sent && contact.consentStatus === WaConsentStatus.PENDING) {
      await this.contactRepository.update(
        { id: contact.id },
        {
          consentStatus: WaConsentStatus.GRANTED,
          consentGrantedAt: new Date(),
        },
      );
    }
  }

  private async discard(messageId: string, reason: string): Promise<void> {
    this.logger.info(`Discarding inbound message: ${reason}`);
    await this.messageRepository.update(
      { id: messageId },
      { status: WaMessageStatus.DISCARDED, errorMessage: reason },
    );
  }

  private async recordUnanswered(
    messageId: string,
    conversationId: string,
    question: string,
    language: string | null | undefined,
    reason: WaUnansweredReason,
    topSimilarity: number | null,
    hitCount: number,
  ): Promise<void> {
    try {
      await this.unansweredRepository
        .createQueryBuilder()
        .insert()
        .into(WaUnansweredQuestion)
        .values({
          messageId,
          conversationId,
          questionText: question,
          language: language ?? null,
          reason,
          topSimilarity:
            topSimilarity === null ? null : String(topSimilarity.toFixed(4)),
          hitCount,
        })
        // Unique on message_id: a redelivery must not double-file the same gap.
        .orIgnore()
        .execute();
    } catch (error) {
      // Never fail a reply that already went out over a bookkeeping row.
      this.logger.error(
        `Could not record an unanswered question: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
