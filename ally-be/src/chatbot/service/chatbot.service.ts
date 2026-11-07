import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { LlmModelService } from '../../llm/service/llm-model.service';
import type { AgentTraceStep, AgentTurnType } from '../../ai/dto/knowledge.dto';
import {
  CreateKbOwnedDocumentDto,
  CreateKbUploadUrlDto,
  KbDocumentResponseDto,
} from '../../knowledge-base/dto/knowledge-base.dto';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import {
  dashboardReadsShared,
  type WhatsAppBotSettings,
} from '../../whatsapp/type/whatsapp-settings.type';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ChatbotMember } from '../entity/chatbot-member.entity';
import { ChatbotAudience } from '../entity/chatbot-audience.entity';
import { Chatbot } from '../entity/chatbot.entity';
import { Connector } from '../entity/connector.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotMemberRole,
  ChatbotRuntime,
  ChatbotStatus,
} from '../enum/chatbot.enum';
import {
  CreateChatbotDto,
  SetChatbotMembersDto,
  TestChatbotDto,
  UpdateChatbotDto,
} from '../dto/chatbot.dto';
import { effectiveRuntime, isFallback } from '../engine/agent-runtime';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import {
  PREVIEW_CHANNEL,
  type AgentFailureReason,
  type ChatbotDecision,
  type LiveReply,
} from '../engine/chatbot-engine.types';
import { withFirstMessageParts } from '../engine/first-reply';
import type { ChatbotModelChoice } from '../type/chatbot.type';
import { AGENT_RUNTIME_DEGRADED_TYPE } from './agent-runtime-alert-throttle.service';
import { ChatbotAccessService } from './chatbot-access.service';
import { ChatbotSettingsService } from './chatbot-settings.service';
import { ConnectorService, ConnectorView } from './connector.service';

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);
const STATS_DAYS = 30;

export interface ChatbotStats {
  messages: number;
  people: number;
  answered: number;
  declined: number;
  openUnanswered: number;
  lastMessageAt: Date | null;
}

export interface ChatbotSummary {
  id: string;
  name: string;
  description: string | null;
  status: ChatbotStatus;
  accessMode: ChatbotAccessMode;
  answerMode: ChatbotAnswerMode;
  knowledgeSource: ChatbotKnowledgeSource;
  persona: Chatbot['persona'];
  model: ChatbotModelChoice | null;
  /** What actually answers: v1 whenever the platform's emergency switch is off. */
  effectiveRuntime: ChatbotRuntime;
  myRole: ChatbotMemberRole;
  connectors: ConnectorView[];
  documentCount: number;
  /** Documents it can answer from now: indexed and not archived. */
  readyDocumentCount: number;
  audienceCount: number;
  memberCount: number;
  stats: ChatbotStats;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What Preview shows for one test message. Nothing is sent or stored. */
export interface ChatbotTestResult {
  reply: string;
  handledBy: WaHandledBy;
  citations: Record<string, any>[];
  retrieval: Record<string, any> | null;
  language: string | null;
  wouldFileUnanswered: ChatbotDecision['unanswered'] | null;
  /** The alert a real message would raise (its type), or null. */
  wouldAlert: string | null;
  latencyMs: number;
  usedDraft: boolean;
  /** The engine that answered: v1, v2, or v1 after v2 failed. */
  runtime: ChatbotRuntime.V1 | AgentRuntimeUsed;
  runId: string | null;
  trace: AgentTraceStep[] | null;
  fallbackReason: AgentFailureReason | null;
  turnType: AgentTurnType | null;
  runtimeAllowed: boolean;
  conversationId: string;
}

/** A bot's documents as the knowledge tab lists them. */
export interface ChatbotDocumentView {
  id: string;
  title: string;
  status: string;
  isGlobal: boolean;
  /** The bot's own document, uploaded on its Knowledge tab; false for a library document. */
  private: boolean;
  archived: boolean;
  updatedAt: Date;
}

/** One of a bot's documents with its text, as the Knowledge tab's panel shows it. */
export interface ChatbotDocumentDetail {
  id: string;
  title: string;
  status: string;
  private: boolean;
  archived: boolean;
  sourceType: string;
  fileName: string | null;
  statusMessage: string | null;
  updatedAt: Date;
  rawText: string;
}

export interface ChatbotMemberView {
  userId: number;
  name: string | null;
  email: string | null;
  role: ChatbotMemberRole;
}

const EMPTY_STATS: ChatbotStats = {
  messages: 0,
  people: 0,
  answered: 0,
  declined: 0,
  openUnanswered: 0,
  lastMessageAt: null,
};

/**
 * Chatbots: create, configure, list with their numbers and activity, and test.
 *
 * Every method that takes a bot id goes through ChatbotAccessService first, so a bot the caller is
 * not a member of answers 404 everywhere.
 */
@Injectable()
export class ChatbotService {
  private readonly logger = LoggerService.getInstance(ChatbotService.name);

  constructor(
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    @InjectRepository(ChatbotMember)
    private readonly memberRepository: Repository<ChatbotMember>,
    @InjectRepository(ChatbotDocument)
    private readonly documentRepository: Repository<ChatbotDocument>,
    @InjectRepository(ChatbotAudience)
    private readonly audienceRepository: Repository<ChatbotAudience>,
    @InjectRepository(Connector)
    private readonly connectorRepository: Repository<Connector>,
    private readonly access: ChatbotAccessService,
    private readonly connectors: ConnectorService,
    private readonly settingsService: ChatbotSettingsService,
    private readonly engine: ChatbotEngineService,
    private readonly llmModels: LlmModelService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  // ───────────────────────────────────────────────────────────── read

  async list(): Promise<ChatbotSummary[]> {
    const ids = await this.access.accessibleChatbotIds();
    if (ids !== null && !ids.length) return [];
    const bots = await this.chatbotRepository.find({
      where: { archivedAt: IsNull(), ...(ids ? { id: In(ids) } : {}) },
      order: { createdAt: 'ASC' },
    });
    return this.summarise(bots);
  }

  async get(id: string): Promise<ChatbotSummary> {
    const { chatbot } = await this.access.assert(id);
    return (await this.summarise([chatbot]))[0];
  }

  private async summarise(bots: Chatbot[]): Promise<ChatbotSummary[]> {
    if (!bots.length) return [];
    const ids = bots.map((b) => b.id);
    const [
      roles,
      connectors,
      docCounts,
      readyDocCounts,
      audienceCounts,
      memberCounts,
      stats,
      defaults,
    ] = await Promise.all([
      this.access.rolesFor(ids),
      this.connectors.summariesForBots(ids),
      this.countBy(this.documentRepository, ids),
      this.readyDocumentCounts(ids),
      this.countBy(this.audienceRepository, ids),
      this.countBy(this.memberRepository, ids),
      this.stats(ids),
      this.settingsService.get(),
    ]);
    return bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      description: bot.description ?? null,
      status: bot.status,
      accessMode: bot.accessMode,
      answerMode: bot.answerMode,
      knowledgeSource: bot.knowledgeSource,
      persona: bot.persona ?? {},
      model: bot.model ?? null,
      effectiveRuntime: effectiveRuntime(defaults),
      myRole: roles.get(bot.id) ?? ChatbotMemberRole.VIEWER,
      connectors: connectors.get(bot.id) ?? [],
      documentCount: docCounts.get(bot.id) ?? 0,
      readyDocumentCount: readyDocCounts.get(bot.id) ?? 0,
      audienceCount: audienceCounts.get(bot.id) ?? 0,
      memberCount: memberCounts.get(bot.id) ?? 0,
      stats: stats.get(bot.id) ?? EMPTY_STATS,
      lastTestedAt: bot.lastTestedAt ?? null,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    }));
  }

  /** Per bot, the documents it can answer from now: indexed and not archived. */
  private async readyDocumentCounts(
    ids: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.chatbotRepository.manager.query<
      { chatbot_id: string; count: string }[]
    >(
      `SELECT cd.chatbot_id, COUNT(*) AS count
         FROM chatbot_documents cd
         JOIN kb_documents d ON d.id = cd.document_id
        WHERE cd.chatbot_id = ANY($1::uuid[])
          AND d.status = 'indexed' AND d.archived_at IS NULL
        GROUP BY cd.chatbot_id`,
      [ids],
    );
    return new Map(rows.map((r) => [r.chatbot_id, Number(r.count)]));
  }

  private async countBy(
    repository: Repository<{ chatbotId: string }>,
    ids: string[],
  ): Promise<Map<string, number>> {
    const rows = await repository
      .createQueryBuilder('r')
      .select('r.chatbotId', 'chatbotId')
      .addSelect('COUNT(*)', 'count')
      .where('r.chatbotId IN (:...ids)', { ids })
      .groupBy('r.chatbotId')
      .getRawMany<{ chatbotId: string; count: string }>();
    return new Map(rows.map((r) => [r.chatbotId, Number(r.count)]));
  }

  /**
   * Last-30-day activity per bot, from the conversations stamped with it. From `wa_*`, or, while
   * the dashboard reads the shared store (chunk 12b), from `chatbot_*`: every channel, the bot page
   * included. The two have the same shape, so one query serves both.
   */
  private async stats(ids: string[]): Promise<Map<string, ChatbotStats>> {
    const shared = dashboardReadsShared(await this.settingsService.get());
    const messages = shared ? 'chatbot_messages' : 'wa_messages';
    const conversations = shared ? 'chatbot_conversations' : 'wa_conversations';
    const rows = await this.chatbotRepository.manager.query<
      {
        chatbot_id: string;
        messages: string;
        people: string;
        answered: string;
        declined: string;
        last_at: Date | null;
      }[]
    >(
      `SELECT c.chatbot_id,
              COUNT(*) FILTER (WHERE m.direction = 'inbound') AS messages,
              COUNT(DISTINCT c.contact_id) AS people,
              COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.handled_by = $3) AS answered,
              COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.handled_by = $4) AS declined,
              MAX(m."createdAt") AS last_at
         FROM ${messages} m
         JOIN ${conversations} c ON c.id = m.conversation_id
        WHERE c.chatbot_id = ANY($1::uuid[])
          AND m."createdAt" >= now() - ($2 || ' days')::interval
        GROUP BY c.chatbot_id`,
      [ids, String(STATS_DAYS), WaHandledBy.RAG, WaHandledBy.DECLINED],
    );
    const open = await this.chatbotRepository.manager.query<
      { chatbot_id: string; open: string }[]
    >(
      `SELECT c.chatbot_id, COUNT(*) AS open
         FROM wa_unanswered_questions q
         JOIN ${conversations} c ON c.id = q.conversation_id
        WHERE c.chatbot_id = ANY($1::uuid[]) AND q.status = 'open'
        GROUP BY c.chatbot_id`,
      [ids],
    );
    const openBy = new Map(open.map((r) => [r.chatbot_id, Number(r.open)]));
    const out = new Map<string, ChatbotStats>();
    for (const id of ids)
      out.set(id, { ...EMPTY_STATS, openUnanswered: openBy.get(id) ?? 0 });
    for (const row of rows) {
      out.set(row.chatbot_id, {
        messages: Number(row.messages),
        people: Number(row.people),
        answered: Number(row.answered),
        declined: Number(row.declined),
        openUnanswered: openBy.get(row.chatbot_id) ?? 0,
        lastMessageAt: row.last_at,
      });
    }
    return out;
  }

  // ───────────────────────────────────────────────────────────── write

  async create(dto: CreateChatbotDto): Promise<ChatbotSummary> {
    await this.access.assertPlatformAdmin();
    const userId = currentUserId();
    const bot = await this.chatbotRepository.save(
      this.chatbotRepository.create({
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        status: ChatbotStatus.DRAFT,
        accessMode: dto.accessMode ?? ChatbotAccessMode.LISTED,
        answerMode: dto.answerMode ?? ChatbotAnswerMode.DOCUMENTS_ONLY,
        knowledgeSource: ChatbotKnowledgeSource.SELECTED,
        persona: { displayName: dto.name.trim(), ...(dto.persona ?? {}) },
        settings: {},
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    // The creator is its first owner, so the team list is never empty and they keep the bot if
    // their platform-wide access is ever narrowed.
    if (userId) {
      await this.memberRepository.save(
        this.memberRepository.create({
          chatbotId: bot.id,
          userId,
          role: ChatbotMemberRole.OWNER,
          createdBy: userId,
        }),
      );
    }
    this.logger.info(`Chatbot ${bot.id} created`);
    return this.get(bot.id);
  }

  async update(id: string, dto: UpdateChatbotDto): Promise<ChatbotSummary> {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.EDITOR);
    if (dto.knowledgeSource === ChatbotKnowledgeSource.ORGANISATION) {
      // Reaches every organisation's targeted documents, so it is a platform decision.
      await this.access.assertPlatformAdmin();
    }
    if (dto.model) await this.assertModel(dto.model);

    const patch: Partial<Chatbot> = { updatedBy: currentUserId() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined)
      patch.description = dto.description?.trim() || null;
    if (dto.persona !== undefined)
      patch.persona = { ...chatbot.persona, ...dto.persona };
    if (dto.answerMode !== undefined) patch.answerMode = dto.answerMode;
    if (dto.accessMode !== undefined) patch.accessMode = dto.accessMode;
    if (dto.knowledgeSource !== undefined)
      patch.knowledgeSource = dto.knowledgeSource;
    if (dto.model !== undefined) {
      patch.model = dto.model
        ? {
            provider: dto.model.provider,
            model: dto.model.model,
            temperature: dto.model.temperature ?? null,
          }
        : null;
    }
    await this.chatbotRepository.update({ id }, patch);
    return this.get(id);
  }

  async setStatus(id: string, status: ChatbotStatus): Promise<ChatbotSummary> {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    await this.chatbotRepository.update(
      { id },
      { status, updatedBy: currentUserId() },
    );
    this.logger.info(`Chatbot ${id} is now ${status}`);
    return this.get(id);
  }

  /**
   * Archive a bot. Its connectors are unbound (not disconnected) so a number can be given to
   * another bot straight away; its conversations stay for the record.
   */
  async archive(id: string): Promise<void> {
    await this.access.assert(id, ChatbotMemberRole.OWNER);
    await this.connectorRepository.update(
      { chatbotId: id },
      { chatbotId: null, updatedBy: currentUserId() },
    );
    // Its own documents go with it: archived, so citations in its old conversations still resolve.
    for (const documentId of await this.ownDocumentIds(id)) {
      await this.knowledgeBase.archiveForChatbot(id, documentId);
    }
    await this.chatbotRepository.update(
      { id },
      {
        archivedAt: new Date(),
        status: ChatbotStatus.PAUSED,
        updatedBy: currentUserId(),
      },
    );
    this.logger.info(`Chatbot ${id} archived`);
  }

  /** Only models ally-ai can run, from the platform's model catalog. */
  private async assertModel(choice: ChatbotModelChoice): Promise<void> {
    const models = await this.llmModels.getModels(LlmRuntime.ALLY_AI);
    const known = models.some(
      (m) => m.provider === choice.provider && m.model === choice.model,
    );
    if (!known) {
      throw new BadRequestException(
        `"${choice.model}" is not a model chatbots can run. Pick one from the list.`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────── knowledge

  async listDocuments(id: string): Promise<ChatbotDocumentView[]> {
    await this.access.assert(id);
    const rows = await this.chatbotRepository.manager.query<
      {
        id: string;
        title: string;
        status: string;
        is_global: boolean;
        owner_chatbot_id: string | null;
        archived_at: Date | null;
        updatedAt: Date;
      }[]
    >(
      `SELECT d.id, d.title, d.status, d.is_global, d.owner_chatbot_id, d.archived_at, d."updatedAt"
         FROM chatbot_documents cd
         JOIN kb_documents d ON d.id = cd.document_id
        WHERE cd.chatbot_id = $1
        ORDER BY d.title`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      isGlobal: r.is_global,
      private: r.owner_chatbot_id === id,
      archived: Boolean(r.archived_at),
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Replace the bot's shared library documents. Only library documents that exist count, plus
   * the bot's own (which stay attached whatever is sent); another bot's own documents are refused.
   */
  async setDocuments(
    id: string,
    documentIds: string[],
  ): Promise<ChatbotDocumentView[]> {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    const own = await this.ownDocumentIds(id);
    const unique = [...new Set([...documentIds, ...own])];
    const existing = unique.length
      ? await this.chatbotRepository.manager.query<{ id: string }[]>(
          `SELECT id FROM kb_documents
            WHERE id = ANY($1::uuid[]) AND corpus = 'whatsapp_qa'
              AND (owner_chatbot_id IS NULL OR owner_chatbot_id = $2)`,
          [unique, id],
        )
      : [];
    if (existing.length !== unique.length) {
      throw new BadRequestException(
        'Some of those documents are not in the knowledge library.',
      );
    }
    const userId = currentUserId();
    await this.documentRepository.manager.transaction(async (manager) => {
      await manager.delete(ChatbotDocument, { chatbotId: id });
      if (unique.length) {
        await manager.insert(
          ChatbotDocument,
          unique.map((documentId) => ({
            chatbotId: id,
            documentId,
            createdBy: userId,
          })),
        );
      }
    });
    return this.listDocuments(id);
  }

  /** Presigned upload for a document of the bot's own (its Knowledge tab). */
  async createDocumentUploadUrl(id: string, dto: CreateKbUploadUrlDto) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.knowledgeBase.createChatbotUploadUrl(id, dto);
  }

  /**
   * Add a document of the bot's own: created in the WhatsApp corpus, owned by this bot (so the
   * library and other bots don't list it), attached, and queued for indexing.
   */
  async addOwnDocument(
    id: string,
    dto: CreateKbOwnedDocumentDto,
  ): Promise<ChatbotDocumentView[]> {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    const document = await this.knowledgeBase.createForChatbot(id, dto);
    await this.documentRepository.insert({
      chatbotId: id,
      documentId: document.id,
      createdBy: currentUserId(),
    });
    return this.listDocuments(id);
  }

  /**
   * Take a document off the bot. The bot's own document is archived as well (citations in old
   * conversations still resolve); a shared one stays in the library.
   */
  async removeDocument(
    id: string,
    documentId: string,
  ): Promise<ChatbotDocumentView[]> {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    if ((await this.ownDocumentIds(id)).includes(documentId)) {
      await this.knowledgeBase.archiveForChatbot(id, documentId);
    }
    await this.documentRepository.delete({ chatbotId: id, documentId });
    return this.listDocuments(id);
  }

  /** One of the bot's documents with its text, for viewing (and editing its own). */
  async getDocument(
    id: string,
    documentId: string,
  ): Promise<ChatbotDocumentDetail> {
    await this.access.assert(id);
    const attached = await this.documentRepository.count({
      where: { chatbotId: id, documentId },
    });
    if (!attached) {
      throw new NotFoundException(`Document ${documentId} was not found`);
    }
    return this.toDocumentDetail(
      id,
      await this.knowledgeBase.getForChatbot(documentId),
    );
  }

  /** Rename one of the bot's own documents, or replace its text (it is then trained again). */
  async updateOwnDocument(
    id: string,
    documentId: string,
    dto: { title?: string; text?: string },
  ): Promise<ChatbotDocumentDetail> {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    await this.knowledgeBase.updateForChatbot(id, documentId, dto);
    return this.getDocument(id, documentId);
  }

  private async toDocumentDetail(
    id: string,
    document: KbDocumentResponseDto,
  ): Promise<ChatbotDocumentDetail> {
    const own = await this.ownDocumentIds(id);
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      private: own.includes(document.id),
      archived: document.isArchived,
      sourceType: document.sourceType,
      fileName: document.fileName ?? null,
      statusMessage: document.statusMessage ?? null,
      updatedAt: document.updatedAt,
      rawText: document.rawText ?? '',
    };
  }

  /** The ids of the bot's own documents that aren't archived. */
  private async ownDocumentIds(id: string): Promise<string[]> {
    const rows = await this.chatbotRepository.manager.query<{ id: string }[]>(
      `SELECT id FROM kb_documents WHERE owner_chatbot_id = $1 AND archived_at IS NULL`,
      [id],
    );
    return rows.map((r) => r.id);
  }

  // ───────────────────────────────────────────────────────────── team

  async listMembers(id: string): Promise<ChatbotMemberView[]> {
    await this.access.assert(id);
    const rows = await this.chatbotRepository.manager.query<
      {
        user_id: number;
        role: ChatbotMemberRole;
        name: string | null;
        email: string | null;
      }[]
    >(
      `SELECT m.user_id, m.role, u.name, u.email
         FROM chatbot_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1
        ORDER BY u.name NULLS LAST`,
      [id],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role,
    }));
  }

  async setMembers(
    id: string,
    dto: SetChatbotMembersDto,
  ): Promise<ChatbotMemberView[]> {
    await this.access.assert(id, ChatbotMemberRole.OWNER);
    const byUser = new Map(dto.members.map((m) => [m.userId, m.role]));
    const userIds = [...byUser.keys()];
    if (userIds.length) {
      const found = await this.chatbotRepository.manager.query<
        { id: number }[]
      >(`SELECT id FROM users WHERE id = ANY($1::int[])`, [userIds]);
      if (found.length !== userIds.length) {
        throw new BadRequestException(
          'Some of those people are not Ally users.',
        );
      }
    }
    if (![...byUser.values()].includes(ChatbotMemberRole.OWNER)) {
      throw new BadRequestException('A chatbot needs at least one owner.');
    }
    const userId = currentUserId();
    await this.memberRepository.manager.transaction(async (manager) => {
      await manager.delete(ChatbotMember, { chatbotId: id });
      await manager.insert(
        ChatbotMember,
        [...byUser].map(([memberId, role]) => ({
          chatbotId: id,
          userId: memberId,
          role,
          createdBy: userId,
        })),
      );
    });
    return this.listMembers(id);
  }

  // ───────────────────────────────────────────────────────────── test

  /**
   * Run one message through the real engine without sending or storing anything.
   *
   * `draft` applies unsaved changes on top of the saved bot, so an admin can try a new persona,
   * model or document selection before saving it. The sender is the admin themselves; the "who can
   * chat" check is skipped unless asked for, since testing is about the answers.
   */
  /**
   * One Preview message, through the production decision path. With `live` (the streamed route)
   * the run's status, steps and checked text are sent as they happen; the result is the same
   * either way, and it is what the streamed route sends as `final`.
   */
  async test(
    id: string,
    dto: TestChatbotDto,
    live?: LiveReply,
  ): Promise<ChatbotTestResult> {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.VIEWER);
    const draft = dto.draft ?? {};
    if (draft.model) await this.assertModel(draft.model);
    const conversationId = dto.conversationId ?? `preview-${randomUUID()}`;

    const bot: Chatbot = {
      ...chatbot,
      persona: draft.persona
        ? { ...chatbot.persona, ...draft.persona }
        : chatbot.persona,
      answerMode: draft.answerMode ?? chatbot.answerMode,
      model:
        draft.model === undefined
          ? chatbot.model
          : draft.model
            ? { ...draft.model, temperature: draft.model.temperature ?? null }
            : null,
      settings: draft.settings ?? chatbot.settings,
      accessMode: dto.checkAccess
        ? chatbot.accessMode
        : ChatbotAccessMode.ANYONE,
    };
    const settings = await this.settingsService.getForChatbot(bot);
    const me = await this.chatbotRepository.manager.query<
      { id: number; email: string; tenant_id: string }[]
    >(`SELECT id, email, tenant_id FROM users WHERE id = $1`, [
      currentUserId(),
    ]);

    // An empty Preview chat stands for a new person, so its first reply looks exactly like the
    // first reply on WhatsApp: a hello gets the welcome message and the first-message notice.
    const isFirstMessage = !(dto.history ?? []).length;
    const startedAt = Date.now();
    const decision = await this.engine.respond(
      {
        chatbot: bot,
        settings,
        text: dto.message,
        history: dto.history ?? [],
        isFirstMessage,
        sender: {
          externalId: `test:${currentUserId()}`,
          label: 'test console',
          userId: me[0]?.id ?? null,
          email: me[0]?.email ?? null,
          tenantId: dto.asTenantId ?? me[0]?.tenant_id ?? null,
        },
        channel: PREVIEW_CHANNEL,
        documentIds: draft.documentIds,
        conversationId,
      },
      live,
    );

    // Remembered so the setup checklist can show the bot has been tried; Preview stores nothing else.
    await this.chatbotRepository.update({ id }, { lastTestedAt: new Date() });

    const reply = isFirstMessage
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

    return this.toTestResult(decision, {
      reply,
      settings,
      conversationId,
      latencyMs: Date.now() - startedAt,
      usedDraft: Boolean(dto.draft),
    });
  }

  /** One Preview test as the console shows it. */
  private toTestResult(
    decision: ChatbotDecision,
    {
      reply,
      settings,
      conversationId,
      latencyMs,
      usedDraft,
    }: {
      reply: string;
      settings: WhatsAppBotSettings;
      conversationId: string;
      latencyMs: number;
      usedDraft: boolean;
    },
  ): ChatbotTestResult {
    const { agent } = decision;
    return {
      reply,
      handledBy: decision.handledBy,
      citations: decision.citations ?? [],
      retrieval: decision.retrievalMeta ?? null,
      language: decision.language ?? null,
      wouldFileUnanswered: decision.unanswered ?? null,
      // Shown rather than sent: the console must never page anyone.
      wouldAlert: decision.alert
        ? decision.alert.type
        : isFallback(agent)
          ? AGENT_RUNTIME_DEGRADED_TYPE
          : null,
      latencyMs,
      usedDraft,
      // Agents v2: which engine answered this test, and the run behind it.
      runtime: agent?.runtime ?? ChatbotRuntime.V1,
      runId: agent?.runId ?? null,
      trace: agent?.runtime === AgentRuntimeUsed.V2 ? agent.trace : null,
      fallbackReason: isFallback(agent) ? agent.fallbackReason : null,
      // What the agent understood the message to be (smalltalk, about_bot, …).
      turnType: decision.turnType ?? null,
      runtimeAllowed: settings.agentRuntimeAllowed,
      conversationId,
    };
  }
}
