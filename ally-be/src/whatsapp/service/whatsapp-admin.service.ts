import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { KbDocument } from 'src/knowledge-base/entity/kb-document.entity';
import {
  KbCorpus,
  KbDocumentStatus,
} from 'src/knowledge-base/enum/knowledge-base.enum';
import { WaKeywordTemplate } from '../entity/wa-keyword-template.entity';
import { WaPhoneMapping } from '../entity/wa-phone-mapping.entity';
import { WaTemplateKind } from '../enum/whatsapp.enum';
import {
  WHATSAPP_PROVIDER,
  WhatsAppConnectionCheck,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import {
  CreateWaTemplateDto,
  PreviewAskDto,
  ReorderWaTemplatesDto,
  TestWaTemplateDto,
  UpdateWaTemplateDto,
} from '../dto/whatsapp.dto';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';
import { composeReply } from '../util/reply-composer';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';

import { KNOWLEDGE_PROMPT_CODES } from 'src/chatbot/engine/chatbot-engine.service';
@Injectable()
export class WhatsAppAdminService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppAdminService.name,
  );

  constructor(
    @InjectRepository(WaKeywordTemplate)
    private readonly templateRepository: Repository<WaKeywordTemplate>,
    @InjectRepository(WaPhoneMapping)
    private readonly phoneMappingRepository: Repository<WaPhoneMapping>,
    @InjectRepository(KbDocument)
    private readonly kbDocumentRepository: Repository<KbDocument>,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly templateService: ChatbotReplyService,
    private readonly settingsService: ChatbotSettingsService,
    private readonly aiService: AiService,
  ) {}

  private userId(): number {
    return Number(ExecutionManager.getUserId() ?? 0);
  }

  // ── templates ─────────────────────────────────────────────────────────

  /**
   * Replies in evaluation order.
   *
   * Without a bot: the GLOBAL replies only, as every bot inherits them.
   * With one: what that bot's bot actually uses, each annotated with where it comes from
   * — `default` (a global reply, untouched), `customised` (its own wording of a global one),
   * `off` (an optional global reply it switched off) or `own` (a reply only it has). A
   * customised or switched-off reply also carries the default wording, for the screen to show.
   */
  async listTemplates(
    kind?: WaTemplateKind,
    includeArchived = false,
    chatbotId?: string,
  ) {
    if (!chatbotId) {
      const templates = await this.templateRepository.find({
        where: {
          chatbotId: IsNull(),
          ...(kind ? { kind } : {}),
          ...(includeArchived ? {} : { archivedAt: IsNull() }),
        },
        // Same order the matcher uses, so what an admin sees IS the evaluation order.
        order: { priority: 'ASC', createdAt: 'ASC' },
      });
      return { templates, count: templates.length };
    }

    const rows = await this.templateRepository.find({
      where: [
        { archivedAt: IsNull(), chatbotId: IsNull() },
        { archivedAt: IsNull(), chatbotId },
      ],
    });
    const globals = new Map(
      rows.filter((r) => !r.chatbotId).map((r) => [r.id, r]),
    );
    const effective = ChatbotReplyService.resolve(rows, chatbotId);
    const templates = effective
      .filter((t) => !kind || t.kind === kind)
      .map((t) => {
        const global = t.overridesTemplateId
          ? globals.get(t.overridesTemplateId)
          : undefined;
        const state = !t.chatbotId
          ? 'default'
          : global
            ? t.active
              ? 'customised'
              : 'off'
            : 'own';
        return {
          ...t,
          state,
          ...(global
            ? {
                name: global.name,
                defaultResponseText: global.responseText,
                defaultPatterns: global.patterns,
              }
            : {}),
        };
      });
    return { templates, count: templates.length };
  }

  /**
   * Create a reply. For a bot, only FAQ and command replies, placed after the safety
   * bands: a bot's own reply can answer a question, never pre-empt a crisis or STOP.
   */
  async createTemplate(dto: CreateWaTemplateDto, chatbotId?: string) {
    this.validatePatterns(dto.matchType, dto.patterns);
    if (chatbotId) this.assertBotKind(dto.kind);

    return this.templateRepository.save(
      this.templateRepository.create({
        ...dto,
        ...(chatbotId
          ? { chatbotId, priority: this.botPriority(dto.kind, dto.priority) }
          : {}),
        bypassRag: dto.bypassRag ?? true,
        terminal: dto.terminal ?? dto.kind === WaTemplateKind.CRISIS,
        active: dto.active ?? true,
        // Only a migration seeds a mandatory rule. An admin-created one can always be removed.
        mandatory: false,
        createdBy: this.userId(),
      }),
    );
  }

  /**
   * An bot's own version of a global reply: reworded, re-keyed, or (if optional)
   * switched off. Creates the override the first time and edits it after, so the screen has one
   * "Customise" action whatever the state. The reply keeps the global's kind and position.
   */
  async customiseTemplate(
    globalId: string,
    chatbotId: string,
    dto: UpdateWaTemplateDto,
  ) {
    const global = await this.templateRepository.findOne({
      where: { id: globalId, chatbotId: IsNull(), archivedAt: IsNull() },
    });
    if (!global)
      throw new NotFoundException(`Template ${globalId} was not found`);
    if (global.mandatory && dto.active === false) {
      throw new ForbiddenException(
        `"${global.name}" is a required safety reply and cannot be switched off. You can change its wording.`,
      );
    }
    const changes = this.overrideFields(dto);
    this.validatePatterns(
      changes.matchType ?? global.matchType,
      changes.patterns ?? global.patterns,
    );

    const existing = await this.templateRepository.findOne({
      where: { chatbotId, overridesTemplateId: global.id, archivedAt: IsNull() },
    });
    if (existing) {
      await this.templateRepository.update(
        { id: existing.id },
        { ...changes, updatedBy: this.userId() },
      );
      return this.findTemplateOrFail(existing.id);
    }
    return this.templateRepository.save(
      this.templateRepository.create({
        kind: global.kind,
        name: global.name,
        matchType: global.matchType,
        patterns: global.patterns,
        languageCode: global.languageCode,
        priority: global.priority,
        responseText: global.responseText,
        bypassRag: global.bypassRag,
        terminal: global.terminal,
        active: true,
        mandatory: false,
        ...changes,
        chatbotId,
        overridesTemplateId: global.id,
        createdBy: this.userId(),
      }),
    );
  }

  async updateTemplate(
    id: string,
    dto: UpdateWaTemplateDto,
    chatbotId?: string,
  ) {
    const template = await this.findTemplateOrFail(id);
    if ((template.chatbotId ?? undefined) !== chatbotId) {
      if (!template.chatbotId && chatbotId) {
        throw new BadRequestException(
          'This is a default reply shared by every chatbot. Customise it for this chatbot instead.',
        );
      }
      throw new NotFoundException(`Template ${id} was not found`);
    }
    if (template.overridesTemplateId) {
      return this.customiseTemplate(
        template.overridesTemplateId,
        chatbotId!,
        dto,
      );
    }

    if (dto.matchType || dto.patterns) {
      this.validatePatterns(
        dto.matchType ?? template.matchType,
        dto.patterns ?? template.patterns,
      );
    }

    // A mandatory rule's WORDING is editable — a helpline number changes, the tone needs work — but
    // it cannot be switched off. A bot for this audience with its crisis reply deactivated is not a
    // degraded bot, it is an unsafe one.
    if (template.mandatory && dto.active === false) {
      throw new ForbiddenException(
        `"${template.name}" is a required safety template and cannot be deactivated. You can edit ` +
          `its wording instead.`,
      );
    }

    await this.templateRepository.update(
      { id },
      {
        ...dto,
        ...(chatbotId
          ? {
              priority: this.botPriority(
                template.kind,
                dto.priority ?? template.priority,
              ),
            }
          : {}),
        updatedBy: this.userId(),
      },
    );
    return this.findTemplateOrFail(id);
  }

  /**
   * Remove a reply. For a bot this removes its own reply, or — for its version of a
   * global one — goes back to the default ("Reset to default"), which is always allowed.
   */
  async archiveTemplate(id: string, chatbotId?: string) {
    const template = await this.findTemplateOrFail(id);
    if ((template.chatbotId ?? undefined) !== chatbotId) {
      throw new NotFoundException(`Template ${id} was not found`);
    }
    if (template.mandatory) {
      throw new ForbiddenException(
        `"${template.name}" is a required safety template and cannot be removed.`,
      );
    }
    await this.templateRepository.update(
      { id },
      { archivedAt: new Date(), updatedBy: this.userId() },
    );
    return this.findTemplateOrFail(id);
  }

  /**
   * Rewrite priorities from an ordered id list.
   *
   * Renumbered in steps of 10 within each kind's band rather than 0..n, so a later insert has room
   * between two rules without another full reorder — and so a reorder can never move an FAQ rule
   * above a crisis rule, because each id keeps its own kind's band. For a bot only its
   * OWN replies move; the global ones keep their places.
   */
  async reorderTemplates(dto: ReorderWaTemplatesDto, chatbotId?: string) {
    const templates = await this.templateRepository.find({
      where: {
        archivedAt: IsNull(),
        chatbotId: chatbotId ?? IsNull(),
        overridesTemplateId: IsNull(),
      },
    });
    const byId = new Map(templates.map((t) => [t.id, t]));

    const bandStart: Record<string, number> = {
      [WaTemplateKind.CRISIS]: 0,
      [WaTemplateKind.CONSENT]: 100,
      [WaTemplateKind.COMMAND]: 200,
      [WaTemplateKind.FAQ]: 300,
    };
    const nextInBand: Record<string, number> = { ...bandStart };

    for (const id of dto.ids) {
      const template = byId.get(id);
      if (!template) continue;
      const priority = (nextInBand[template.kind] ?? 300) + 10;
      nextInBand[template.kind] = priority;
      await this.templateRepository.update({ id }, { priority });
    }

    return this.listTemplates(undefined, false, chatbotId);
  }

  /** Only the wording and matching of a global reply are a bot's to change. */
  private overrideFields(dto: UpdateWaTemplateDto): Partial<WaKeywordTemplate> {
    const out: Partial<WaKeywordTemplate> = {};
    if (dto.responseText !== undefined) out.responseText = dto.responseText;
    if (dto.patterns !== undefined) out.patterns = dto.patterns;
    if (dto.matchType !== undefined) out.matchType = dto.matchType;
    if (dto.active !== undefined) out.active = dto.active;
    return out;
  }

  private assertBotKind(kind: WaTemplateKind): void {
    if (kind !== WaTemplateKind.FAQ && kind !== WaTemplateKind.COMMAND) {
      throw new BadRequestException(
        'A chatbot can add FAQ and command replies. Crisis and consent replies are shared by every chatbot; customise their wording instead.',
      );
    }
  }

  /** Inside the kind's band and never ahead of the safety bands. */
  private botPriority(kind: WaTemplateKind, requested?: number): number {
    const floor = kind === WaTemplateKind.COMMAND ? 200 : 300;
    const ceiling = kind === WaTemplateKind.COMMAND ? 299 : 9999;
    const value = requested ?? floor + 50;
    return Math.min(Math.max(value, floor), ceiling);
  }

  /**
   * Which rule a given message would match — without sending anything.
   *
   * The point of this endpoint is that template ordering is safety-critical and invisible: an admin
   * cannot otherwise tell that their new FAQ rule now swallows a phrase the crisis rule used to
   * catch.
   */
  async testTemplate(dto: TestWaTemplateDto, chatbotId?: string) {
    const settings = await this.settingsService.getForChatbot(
      chatbotId
        ? await this.chatbotRepository.findOne({ where: { id: chatbotId } })
        : null,
    );
    const match = await this.templateService.match(
      dto.text,
      dto.language,
      chatbotId ?? null,
    );

    if (!match) {
      return {
        matched: false,
        normalisedText: ChatbotReplyService.normalise(dto.text),
        wouldReachRetrieval: true,
      };
    }

    return {
      matched: true,
      normalisedText: ChatbotReplyService.normalise(dto.text),
      template: {
        id: match.template.id,
        name: match.template.name,
        kind: match.template.kind,
        priority: match.template.priority,
      },
      reply: this.settingsService.renderPlaceholders(
        match.template.responseText,
        settings,
      ),
      terminal: match.terminal,
      wouldReachRetrieval: !match.bypassRag,
    };
  }

  private validatePatterns(matchType: string, patterns: string[]): void {
    const cleaned = (patterns ?? []).filter((p) => p?.trim());
    if (!cleaned.length) {
      throw new BadRequestException('A template needs at least one pattern.');
    }
    if (matchType === 'regex') {
      for (const source of cleaned) {
        try {
          new RegExp(source, 'iu');
        } catch (error) {
          // Validated on save rather than discovered at match time: an invalid regex saved here is
          // skipped silently by the matcher, so the rule would look active and never fire.
          throw new BadRequestException(
            `"${source}" is not a valid regular expression: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
    }
  }

  private async findTemplateOrFail(id: string): Promise<WaKeywordTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} was not found`);
    return template;
  }

  // ── settings ──────────────────────────────────────────────────────────

  getSettings() {
    return this.settingsService.get();
  }

  updateSettings(patch: Record<string, unknown>) {
    return this.settingsService.update(patch);
  }

  /**
   * Whether the provider is configured, without revealing any secret.
   *
   * Booleans only — never the values. An admin needs to know "is the app secret set", and returning
   * the secret to answer that would put it in a browser and in any screenshot of this screen.
   */
  async providerHealth() {
    const settings = await this.settingsService.get();
    const [mappedNumbers, indexedDocuments] = await Promise.all([
      this.phoneMappingRepository.count(),
      this.kbDocumentRepository.count({
        where: {
          corpus: KbCorpus.WHATSAPP_QA,
          status: KbDocumentStatus.INDEXED,
          archivedAt: IsNull(),
        },
      }),
    ]);
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
      phoneNumberIdConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      accessTokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      businessAccountIdConfigured: Boolean(
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      ),
      inboundQueueConfigured: Boolean(
        process.env.SQS_WHATSAPP_INBOUND_QUEUE_URL,
      ),
      inboundDlqConfigured: Boolean(process.env.SQS_WHATSAPP_INBOUND_DLQ_URL),
      // The corpus upload queue belongs to the knowledge base, but without it no document ever
      // reaches retrieval and the bot declines every question — so it is part of "is the bot
      // ready", and the one place anyone looks for that is this screen.
      kbIngestQueueConfigured: Boolean(process.env.SQS_KB_INGEST_QUEUE_URL),
      // Readiness beyond configuration. Every number the bot cannot map to an organisation is
      // refused, every question against an empty corpus is declined, and a crisis reply with no
      // helpline in it points at "your local crisis line" — each is a bot that is technically up
      // and useless (or worse) to the worker, so each is shown before the switch is flipped.
      helplineNumbersSet: Boolean(settings.helplineNumbers?.trim()),
      mappedNumbers,
      indexedDocuments,
    };
  }

  /** Ask Meta, live, whether the token and number work. Reads only. */
  async checkProviderConnection(): Promise<WhatsAppConnectionCheck> {
    if (!this.provider.checkConnection) {
      return {
        ok: false,
        error: `The ${this.provider.name} provider has no connection check.`,
        subscribedApps: null,
      };
    }
    return this.provider.checkConnection();
  }

  /** Register the number for Cloud API use. Meta's error, if any, is returned as a 400. */
  async registerPhoneNumber(pin: string): Promise<WhatsAppConnectionCheck> {
    if (!this.provider.registerPhoneNumber) {
      throw new BadRequestException(
        `The ${this.provider.name} provider does not support registration.`,
      );
    }
    try {
      await this.provider.registerPhoneNumber(pin);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Registration failed',
      );
    }
    this.logger.info(
      `WhatsApp phone number registered by user ${this.userId()}`,
    );
    return this.checkProviderConnection();
  }

  /** Subscribe the app to the business account's webhooks. */
  async subscribeProviderApp(): Promise<WhatsAppConnectionCheck> {
    if (!this.provider.subscribeApp) {
      throw new BadRequestException(
        `The ${this.provider.name} provider has no webhook subscription step.`,
      );
    }
    try {
      await this.provider.subscribeApp();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Subscription failed',
      );
    }
    this.logger.info(
      `WhatsApp app subscribed to webhooks by user ${this.userId()}`,
    );
    return this.checkProviderConnection();
  }

  // ── preview console ───────────────────────────────────────────────────

  /**
   * Run a question through retrieval and answering, and return what WOULD be sent.
   *
   * Sends nothing and writes no message rows: this is a tuning tool, and letting it record
   * conversations would pollute the log and the unanswered queue with the admin's own experiments.
   *
   * It is what makes prompt, threshold and corpus changes verifiable without a phone — the
   * difference between tuning and guessing.
   */
  async previewAsk(dto: PreviewAskDto) {
    const settings = await this.settingsService.get();
    const retrieval = { ...settings.retrieval, ...(dto.retrieval ?? {}) };
    const startedAt = Date.now();

    const answer = await this.aiService.answerKnowledgeQuestion({
      question: dto.question,
      history: [],
      // With no organisation named the preview searches the WHOLE corpus, targeting included.
      // That is right for a tuning console — its job is to show what is indexed — but it is NOT
      // what any real worker gets, so a question about what one customer can actually see has to
      // name them. The reply below reports which of the two ran.
      audience: dto.tenantId
        ? { tenant_id: dto.tenantId, include_global: true }
        : { unrestricted: true },
      top_k: retrieval.topK,
      min_similarity: retrieval.minSimilarity,
      decline_similarity: retrieval.declineSimilarity,
      max_passages: retrieval.maxPassages,
      max_context_tokens: retrieval.maxContextTokens,
      similarity_band: retrieval.similarityBand,
      max_answer_chars: settings.maxAnswerChars,
      translate_query: retrieval.translateQuery,
      // The live prompts, as a worker's question gets them: the preview exists
      // to check prompt changes, so it must run the Skills Store's text.
      prompts: await this.aiService.getPromptOverrides(KNOWLEDGE_PROMPT_CODES),
    });

    const composed = composeReply({
      intent: answer.intent,
      answer: answer.answer,
      declineText: settings.declineText,
      citations: answer.citations,
      maxAnswerChars: settings.maxAnswerChars,
      maxReplyChars: settings.maxReplyChars,
      maxCitations: settings.maxCitations,
    });

    return {
      intent: answer.intent,
      declineReason: answer.decline_reason,
      // The exact text a worker would receive, including source lines and truncation, so an admin
      // sees the real thing rather than the model's raw output.
      reply: composed,
      replyLength: composed.length,
      language: answer.language,
      citations: answer.citations,
      retrieval: answer.retrieval,
      provider: answer.provider,
      model: answer.model,
      promptVersion: answer.prompt_version,
      latencyMs: Date.now() - startedAt,
      // Echoed back so the console can say which corpus answered. Without it, "the bot found
      // this fine" from an unscoped preview is indistinguishable from what a specific
      // customer's worker would get, and that is the exact confusion this whole feature
      // introduces.
      audience: dto.tenantId
        ? { tenantId: dto.tenantId, includesGlobal: true }
        : { tenantId: null, includesGlobal: true },
    };
  }
}
