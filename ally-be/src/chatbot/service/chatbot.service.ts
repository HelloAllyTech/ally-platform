import { withoutStopLine } from '../safety/chat-notice';
import { realName } from '../../bot-draft/name-placeholders';
import { ActionsService } from '../actions/actions.service';
import {
  ActionPartsService,
  type ReplyParts,
} from '../actions/action-parts.service';
import { TEST_ONLY } from '../actions/action-copy';
import { LedgerService } from 'src/billing/service/ledger.service';
import { PlanService } from 'src/billing/service/plan.service';
import { replyLanguageOf } from '../engine/reply-language';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { LlmModelService } from '../../llm/service/llm-model.service';
import type {
  AgentRunRequest,
  AgentTraceStep,
  AgentTurnType,
} from '../../ai/dto/knowledge.dto';
import {
  CreateKbOwnedDocumentDto,
  CreateKbUploadUrlDto,
  KbDocumentResponseDto,
} from '../../knowledge-base/dto/knowledge-base.dto';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import { dashboardReadsShared } from '../../whatsapp/type/whatsapp-settings.type';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ChatbotMember } from '../entity/chatbot-member.entity';
import { ChatbotAudience } from '../entity/chatbot-audience.entity';
import { Chatbot } from '../entity/chatbot.entity';
import { Connector } from '../entity/connector.entity';
import { ToolRunStatus } from '../entity/tool-run.entity';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotMemberRole,
  ChatbotStatus,
} from '../enum/chatbot.enum';
import {
  CreateChatbotDto,
  SetChatbotMembersDto,
  TestChatbotDto,
  UpdateChatbotDto,
} from '../dto/chatbot.dto';
import { isFailedRun } from '../engine/agent-runtime';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import {
  PREVIEW_CHANNEL,
  type AgentFailureReason,
  type ChatbotDecision,
  type LiveReply,
} from '../engine/chatbot-engine.types';
import { withFirstMessageParts } from '../engine/first-reply';
import { startNotice } from '../safety/chat-notice';
import { GoLiveGateService } from '../safety/go-live-gate.service';
import type { ChatbotModelChoice } from '../type/chatbot.type';
import { AGENT_RUNTIME_DEGRADED_TYPE } from './agent-runtime-alert-throttle.service';
import { QuickReplyCopyService } from '../quick-replies/quick-reply-copy.service';
import { ChatbotAccessService } from './chatbot-access.service';
import { ChatbotSettingsService } from './chatbot-settings.service';
import { ConnectorService, ConnectorView } from './connector.service';
import { legacyRole } from '../access/chatbot-roles';
import {
  ChatbotMembersService,
  type ChatbotMemberView,
} from '../members/chatbot-members.service';

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
  /** OLD single role (highest of `myRoles` on the old ladder). Kept for old dashboards. */
  myRole: ChatbotMemberRole;
  /** Stage 1b: the caller's roles on it, a set. */
  myRoles: ChatbotMemberRole[];
  connectors: ConnectorView[];
  documentCount: number;
  /** Documents it can answer from now: indexed and not archived. */
  readyDocumentCount: number;
  audienceCount: number;
  memberCount: number;
  stats: ChatbotStats;
  /**
   * Conversations waiting for a person (needs-a-person set, nobody has taken them). Counted only
   * for members who can respond, edit or own; zero for everyone else.
   */
  waitingForPerson: number;
  lastTestedAt: Date | null;
  /** The caller's own unfinished onboarding for this bot (chunk 20a): "Continue setup". */
  setupDraftId: string | null;
  /**
   * Stage 3: created at the click and not touched yet (no template, path, source, edit or test).
   * The home leaves these out of the grid and the counts.
   */
  blank: boolean;
  /** When it was removed: an archived bot is read-only. */
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What Preview shows for one test message. Nothing is sent or stored. */
/**
 * Stage 3: a server-side override for a Preview test, built from a live chatbot's working copy so
 * the builder tries their pending changes without anything reaching customers. Only ally-be code
 * builds one; a client-sent `draft` is a different, separately validated input.
 */
export interface ChatbotTestOverride {
  name?: string;
  persona?: Partial<Chatbot['persona']>;
  settings?: Chatbot['settings'];
  rules?: Chatbot['rules'];
  /** The documents to answer from (live ones plus staged sources). */
  documentIds?: string[];
  /** Write nothing to the chatbot row, not even `lastTestedAt`. */
  readOnly?: boolean;
}

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
  /**
   * The run behind this reply: v2, or `v2_fallback` when the run failed and the fixed run-failed
   * reply went out (Q3-fast: never v1). Null when no run was involved (a keyword reply).
   */
  runtime: AgentRuntimeUsed | null;
  runId: string | null;
  trace: AgentTraceStep[] | null;
  fallbackReason: AgentFailureReason | null;
  turnType: AgentTurnType | null;
  conversationId: string;
  /** The run booked or changed a list entry, checked and not saved (chunk 5b). */
  previewWrite?: boolean;
  /**
   * What the run would have remembered about the person (chunk 8a): the lines it asked to add or
   * change. Try it never saves them. Absent when nothing.
   */
  wouldRemember?: string[];
  /** BT1: chips and cards, as on the bot page; each button's token is sent back as `action`. */
  parts?: ReplyParts;
  /** BT1: a Confirm tap's done card, marked "Test only, not saved". */
  confirmation?: ChatbotDecision['tapDone'] & { testOnly?: string };
  /** BT1: what the tap stood for, shown as the person's message. */
  tapped?: string;
}

/**
 * What a Try it run would have remembered (chunk 8a): the texts of its add and replace writes, when
 * the reply was the agent's own, as a live chat would store them. Nothing is saved.
 */
export function wouldRemember(
  decision: Pick<ChatbotDecision, 'agent' | 'handledBy'>,
): string[] {
  const agent = decision.agent;
  if (agent?.runtime !== AgentRuntimeUsed.V2 || !agent.memory) return [];
  if (
    ![WaHandledBy.RAG, WaHandledBy.DECLINED, WaHandledBy.CLARIFIED].includes(
      decision.handledBy,
    )
  ) {
    return [];
  }
  return agent.memory.writes
    .filter((w) => (w.op === 'add' || w.op === 'replace') && w.text?.trim())
    .map((w) => w.text!.trim())
    .slice(0, 6);
}

/** A bot's documents as the knowledge tab lists them. */
export interface ChatbotDocumentView {
  id: string;
  title: string;
  status: string;
  /** Why it is in that state, when there is a reason (e.g. paused: out of credits). */
  statusMessage?: string | null;
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

export type { ChatbotMemberView };

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
/** After a Try it reply that booked or changed something (Q4 B4): fixed text, by language. */
export const TEST_NOT_SAVED: Record<string, string> = {
  en: '(Test only, not saved: Try it never saves bookings or details.)',
  hi: '(सिर्फ़ टेस्ट, सेव नहीं हुआ: Try it में कुछ सेव नहीं होता।)',
  'hi-latn': '(Sirf test, save nahi hua: Try it mein kuch save nahi hota.)',
};

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
    // CR1: going live is publishing, under the plan's limit (optional for existing specs).
    @Optional() private readonly plans?: PlanService,
    // Stage 1b: the team (roles as a set, last owner, creator). Optional for existing specs.
    @Optional() private readonly members?: ChatbotMembersService,
    // Stage 6: archiving returns the unspent budget to the free balance. Optional for specs.
    @Optional() private readonly ledger?: LedgerService,
    // Stage 5 (D6): every new chatbot gets its own copy of the quick replies. Optional for specs.
    @Optional() private readonly quickReplies?: QuickReplyCopyService,
    // Stage 4: the go-live gate on the status switch (D10). Optional for specs.
    @Optional() private readonly goLive?: GoLiveGateService,
    // BT1: taps and a reply's chips and cards in Try it. Optional for specs.
    @Optional() private readonly actions?: ActionsService,
    @Optional() private readonly parts?: ActionPartsService,
  ) {}

  // ───────────────────────────────────────────────────────────── read

  async list(): Promise<ChatbotSummary[]> {
    const ids = await this.access.accessibleChatbotIds();
    if (!ids.length) return [];
    const bots = await this.chatbotRepository.find({
      where: { archivedAt: IsNull(), id: In(ids) },
      order: { createdAt: 'ASC' },
    });
    return this.summarise(bots);
  }

  /** Removed (archived) bots the caller can see, most recently removed first: read-only. */
  async listArchived(): Promise<ChatbotSummary[]> {
    const ids = await this.access.accessibleChatbotIds();
    if (!ids.length) return [];
    const bots = await this.chatbotRepository.find({
      where: { archivedAt: Not(IsNull()), id: In(ids) },
      order: { archivedAt: 'DESC' },
      take: 200,
    });
    return this.summarise(bots);
  }

  /**
   * One bot's numbers over the last 7 or 30 days (chunk 20d-2: the home's 7 days / 30 days
   * switch). Always from the shared store (`chatbot_*`), the one the Overview's "This week" counts,
   * so the two never disagree (Q3d; prod 18 Nov: "7 conversations" beside "People 0, Messages 0",
   * because the bot page's chats are only in `chatbot_*`). Access is checked by the caller.
   */
  async statsFor(id: string, days: 7 | 30): Promise<ChatbotStats> {
    const stats = await this.stats([id], days, true);
    return stats.get(id) ?? { ...EMPTY_STATS };
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
      setups,
      waiting,
      blanks,
    ] = await Promise.all([
      this.access.roleSetsFor(ids),
      this.connectors.summariesForBots(ids),
      this.countBy(this.documentRepository, ids),
      this.readyDocumentCounts(ids),
      this.countBy(this.audienceRepository, ids),
      this.countBy(this.memberRepository, ids),
      this.stats(ids),
      this.setupDraftRows(ids),
      this.waitingCounts(ids),
      this.untouchedBlanks(ids),
    ]);
    return bots.map((bot) => ({
      id: bot.id,
      // TF1 F5: before go-live the name is in the working copy; the card said "Your assistant".
      name:
        bot.status === ChatbotStatus.DRAFT
          ? realName(setups.get(bot.id)?.name ?? '', bot.name)
          : bot.name,
      description: bot.description ?? null,
      status: bot.status,
      accessMode: bot.accessMode,
      answerMode: bot.answerMode,
      knowledgeSource: bot.knowledgeSource,
      persona: bot.persona ?? {},
      model: bot.model ?? null,
      myRole: legacyRole(roles.get(bot.id) ?? [ChatbotMemberRole.VIEWER]),
      myRoles: roles.get(bot.id) ?? [],
      connectors: connectors.get(bot.id) ?? [],
      documentCount: docCounts.get(bot.id) ?? 0,
      readyDocumentCount: readyDocCounts.get(bot.id) ?? 0,
      audienceCount: audienceCounts.get(bot.id) ?? 0,
      memberCount: memberCounts.get(bot.id) ?? 0,
      stats: stats.get(bot.id) ?? EMPTY_STATS,
      waitingForPerson: waiting.get(bot.id) ?? 0,
      lastTestedAt: bot.lastTestedAt ?? null,
      setupDraftId: setups.get(bot.id)?.id ?? null,
      blank: blanks.has(bot.id),
      archivedAt: bot.archivedAt ?? null,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    }));
  }

  /**
   * Per bot, the conversations waiting for a person, for the bots where the caller can respond:
   * an Editor or Owner, or a member holding Responder (read from the `roles` column when the
   * roles migration has run). Everywhere else the count is left out, so it reads as zero.
   */
  private async waitingCounts(ids: string[]): Promise<Map<string, number>> {
    const userId = currentUserId();
    if (!userId || !ids.length) return new Map();
    const manager = this.chatbotRepository.manager;
    const hasRoles =
      (
        (await manager.query(
          `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chatbot_members' AND column_name = 'roles' LIMIT 1`,
        )) ?? []
      ).length > 0;
    const responder = hasRoles
      ? ` OR to_jsonb(m."roles") ? 'responder' OR to_jsonb(m."roles") ? 'editor' OR to_jsonb(m."roles") ? 'owner'`
      : '';
    const rows = ((await manager.query(
      `SELECT c.chatbot_id, COUNT(*) AS count
         FROM chatbot_conversations c
         JOIN chatbot_members m ON m.chatbot_id = c.chatbot_id AND m.user_id = $2
        WHERE c.chatbot_id = ANY($1::uuid[])
          AND c.needs_person_since IS NOT NULL AND c.handled_by_user_id IS NULL
          AND (m.role IN ('editor', 'owner')${responder})
        GROUP BY c.chatbot_id`,
      [ids, userId],
    )) ?? []) as { chatbot_id: string; count: string }[];
    return new Map(rows.map((r) => [r.chatbot_id, Number(r.count)]));
  }

  /**
   * The caller's own unfinished onboarding per bot. Read directly: onboarding's module imports this
   * one, so the dependency can't run the other way. Only the person setting it up resumes it.
   */
  private async setupDrafts(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      [...(await this.setupDraftRows(ids)).entries()].map(([k, v]) => [
        k,
        v.id,
      ]),
    );
  }

  /** The caller's open setup per bot: its id and the name typed in its working copy. */
  private async setupDraftRows(
    ids: string[],
  ): Promise<Map<string, { id: string; name: string | null }>> {
    const userId = currentUserId();
    if (!userId) return new Map();
    const rows = await this.chatbotRepository.manager.query<
      { chatbot_id: string; id: string; name: string | null }[]
    >(
      `SELECT chatbot_id, id, draft_config->>'name' AS name FROM bot_drafts
        WHERE chatbot_id = ANY($1::uuid[]) AND status = 'active' AND owner_user_id = $2`,
      [ids, userId],
    );
    return new Map(
      (rows ?? []).map((row) => [
        row.chatbot_id,
        { id: row.id, name: row.name ?? null },
      ]),
    );
  }

  /** Stage 3: the bots that are still untouched blanks (created at the click, nothing chosen). */
  private async untouchedBlanks(ids: string[]): Promise<Set<string>> {
    try {
      const rows = await this.chatbotRepository.manager.query<
        { chatbot_id: string }[]
      >(
        `SELECT chatbot_id FROM bot_drafts
          WHERE chatbot_id = ANY($1::uuid[]) AND blank = true AND touched_at IS NULL`,
        [ids],
      );
      return new Set((rows ?? []).map((row) => row.chatbot_id));
    } catch {
      // Before the stage 3 migration: nothing is a blank.
      return new Set();
    }
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
   * included. The two have the same shape, so one query serves both. `fromSharedStore` reads
   * `chatbot_*` whatever the dashboard setting.
   */
  private async stats(
    ids: string[],
    days = STATS_DAYS,
    fromSharedStore = false,
  ): Promise<Map<string, ChatbotStats>> {
    const shared =
      fromSharedStore || dashboardReadsShared(await this.settingsService.get());
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
      [ids, String(days), WaHandledBy.RAG, WaHandledBy.DECLINED],
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
    await this.access.assertCanCreate();
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
    // The creator is its first owner: nobody else sees the bot until they are added to its team.
    if (userId) {
      await this.memberRepository.save(
        this.memberRepository.create({
          chatbotId: bot.id,
          userId,
          role: ChatbotMemberRole.OWNER,
          roles: [ChatbotMemberRole.OWNER],
          createdBy: userId,
        }),
      );
    }
    await this.quickReplies?.copyGlobalsInto(bot.id).catch((error: unknown) =>
      // The globals still answer for it until the copy runs (mandatory ones always do).
      this.logger.warn(
        `Quick replies not copied into chatbot ${bot.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      ),
    );
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
    if (status === ChatbotStatus.LIVE) {
      // Stage 4: the one go-live check, refused before anything is written.
      await this.goLive?.assertCanGoLive(id);
      await this.plans?.assertCanPublish(id);
    }
    await this.chatbotRepository.update(
      { id },
      { status, updatedBy: currentUserId() },
    );
    if (status === ChatbotStatus.LIVE) {
      await this.plans?.ensureIncludedSeats(id).catch(() => undefined);
      // TF1 S2: without a budget a live assistant answers nobody.
      await this.ledger
        ?.ensureStartingBudget(id, currentUserId() || null)
        .catch((error: unknown) =>
          this.logger.warn(
            `Starting budget not set for chatbot ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
    }
    // One switch: live means people can use it, so its page (and website chat) turns on with it.
    // Pausing leaves the page on, where visitors see that it's away rather than a missing page.
    if (status === ChatbotStatus.LIVE) {
      await this.chatbotRepository.manager.query(
        `UPDATE chatbot_pages SET status = 'on', "updatedAt" = now() WHERE chatbot_id = $1`,
        [id],
      );
    }
    this.logger.info(`Chatbot ${id} is now ${status}`);
    return this.get(id);
  }

  /**
   * Archive a bot. Its connectors are unbound (not disconnected) so a number can be given to
   * another bot straight away; its conversations stay for the record.
   */
  async archive(id: string): Promise<void> {
    await this.access.assert(id, ChatbotMemberRole.OWNER);
    // Taken first, so every document archived below is at or after it: restore() finds them so.
    const removedAt = new Date();
    // Stage 1b: under the bot's row lock, so a member change can't interleave with removing it,
    // and a second archive of the same bot stops here.
    await this.chatbotRepository.manager.transaction(async (m) => {
      const [row] = await m.query<{ archived_at: Date | null }[]>(
        `SELECT archived_at FROM chatbots WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!row || row.archived_at) {
        throw new NotFoundException('Chatbot not found');
      }
      await m.query(
        `UPDATE chatbots SET archived_at = $2, status = $3, updated_by = $4, "updatedAt" = now() WHERE id = $1`,
        [id, removedAt, ChatbotStatus.PAUSED, currentUserId() || null],
      );
    });
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
        archivedAt: removedAt,
        status: ChatbotStatus.PAUSED,
        updatedBy: currentUserId(),
      },
    );
    // An unfinished setup goes with it, so a bot removed mid-setup isn't read or resumed again.
    await this.chatbotRepository.manager.query(
      `UPDATE bot_drafts SET status = 'abandoned'
        WHERE chatbot_id = $1 AND status = 'active'`,
      [id],
    );
    // Stage 6 (Ledger edges): what its budget had not spent goes back to the free balance.
    await this.ledger
      ?.archiveBudget(id)
      .catch((error: unknown) =>
        this.logger.warn(
          `Budget of archived chatbot ${id} not returned yet (the nightly rebuild will not do it): ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        ),
      );
    this.logger.info(`Chatbot ${id} archived`);
  }

  /**
   * Bring a removed bot back, paused, so nothing answers until an owner turns it on. Its own
   * documents archived by the removal come back (not ones removed before it); a bot removed
   * mid-setup gets its setup back. Its channels don't: a number may serve another bot by now.
   */
  async restore(id: string): Promise<ChatbotSummary> {
    // Viewing is all an archived bot allows, so the owner check is made here.
    const { chatbot, role } = await this.access.assert(id);
    if (!chatbot.archivedAt) return this.get(id);
    if (role !== ChatbotMemberRole.OWNER) {
      throw new ForbiddenException("Only this chatbot's owners can do this.");
    }
    const documents = await this.chatbotRepository.manager.query<
      { id: string }[]
    >(
      // A minute's grace for bots removed before archive() took its time first.
      `SELECT id FROM kb_documents
        WHERE owner_chatbot_id = $1
          AND archived_at >= $2::timestamptz - interval '1 minute'`,
      [id, chatbot.archivedAt],
    );
    for (const { id: documentId } of documents) {
      await this.knowledgeBase.unarchiveForChatbot(id, documentId);
    }
    // Never live: its setup comes back, to continue where it stopped.
    const setup = await this.chatbotRepository.manager.query<{ id: string }[]>(
      `SELECT id FROM bot_drafts
        WHERE chatbot_id = $1 AND status = 'abandoned'
          AND NOT EXISTS (
            SELECT 1 FROM bot_drafts p WHERE p.chatbot_id = $1 AND p.status = 'published'
          )
        ORDER BY "updatedAt" DESC LIMIT 1`,
      [id],
    );
    if (setup[0]) {
      await this.chatbotRepository.manager.query(
        `UPDATE bot_drafts SET status = 'active' WHERE id = $1`,
        [setup[0].id],
      );
    }
    await this.chatbotRepository.update(
      { id },
      {
        archivedAt: null,
        status: setup[0] ? ChatbotStatus.DRAFT : ChatbotStatus.PAUSED,
        updatedBy: currentUserId(),
      },
    );
    this.logger.info(
      `Chatbot ${id} restored (${documents.length} documents back)`,
    );
    return this.get(id);
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
        status_message: string | null;
        is_global: boolean;
        owner_chatbot_id: string | null;
        archived_at: Date | null;
        updatedAt: Date;
      }[]
    >(
      `SELECT d.id, d.title, d.status, d.status_message, d.is_global, d.owner_chatbot_id, d.archived_at, d."updatedAt"
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
      // Why it is in that state (e.g. paused: out of credits), for the documents list.
      statusMessage: r.status_message ?? null,
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
    // Stage 5 (copy, not share): a builder can no longer attach a shared library document; they
    // copy it instead (Copy knowledge, the curated pool). What is attached already stays allowed,
    // so saving the list unchanged never fails. Ally staff can still attach.
    if (!(await this.access.isPlatformAdmin())) {
      const attached = new Set(
        (
          await this.chatbotRepository.manager.query<{ document_id: string }[]>(
            `SELECT document_id FROM chatbot_documents WHERE chatbot_id = $1`,
            [id],
          )
        ).map((r) => r.document_id),
      );
      const ownSet = new Set(own);
      if (unique.some((d) => !ownSet.has(d) && !attached.has(d))) {
        throw new BadRequestException(
          // COPY: needs approval
          'Shared documents can no longer be added. Copy the document to this chatbot instead.',
        );
      }
    }
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
    return this.team().list(id);
  }

  /**
   * Replace the team. Each member gives `roles` (a set) or the old single `role`. Locks the bot's
   * row; refuses a team with no owner, or one that drops the creator (`creator_must_transfer`).
   * `manager`: run inside the caller's transaction (the home's team list holds the row lock).
   */
  async setMembers(
    id: string,
    dto: SetChatbotMembersDto,
    manager?: EntityManager,
  ): Promise<ChatbotMemberView[]> {
    return this.team().set(id, dto.members, manager);
  }

  private team(): ChatbotMembersService {
    if (!this.members) throw new Error('ChatbotMembersService not provided');
    return this.members;
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
  /**
   * What a v2 answer from this assistant would send to `/agent/run`, for the owner's "How it
   * works" (chunk 20d-2): the same Preview turn `test` builds, without a message, through the
   * engine's own request builder. Nothing is answered, stored or sent.
   */
  async agentRequestFor(id: string): Promise<AgentRunRequest> {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.VIEWER);
    const bot: Chatbot = { ...chatbot, accessMode: ChatbotAccessMode.ANYONE };
    const settings = await this.settingsService.getForChatbot(bot);
    return this.engine.agentRequestFor({
      chatbot: bot,
      settings,
      // ally-ai shows its own placeholder where the visitor's message goes.
      text: "(the visitor's message)",
      history: [],
      isFirstMessage: false,
      sender: {
        externalId: `how-it-works:${currentUserId()}`,
        label: 'how it works',
        userId: currentUserId() || null,
        email: null,
        tenantId: null,
      },
      channel: PREVIEW_CHANNEL,
    });
  }

  async test(
    id: string,
    dto: TestChatbotDto,
    live?: LiveReply,
    server?: ChatbotTestOverride,
  ): Promise<ChatbotTestResult> {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.VIEWER);
    // A removed assistant can be read, never run.
    if (chatbot.archivedAt) throw new NotFoundException('Chatbot not found');
    const draft = dto.draft ?? {};
    if (draft.model) await this.assertModel(draft.model);
    const conversationId = dto.conversationId ?? `preview-${randomUUID()}`;
    // BT1: a tap in Try it counts only in its own test chat; nothing it confirms is saved.
    const tap =
      dto.action && this.actions
        ? await this.actions.redeem(dto.action, {
            chatbotId: id,
            conversationId,
            contactId: null,
          })
        : undefined;
    const said = tap?.ok ? tap.claims.text : dto.message;

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
      // Stage 3: a live chatbot's working copy, built on the server (never from the request).
      ...(server?.name !== undefined ? { name: server.name } : {}),
      ...(server?.persona
        ? { persona: { ...chatbot.persona, ...server.persona } }
        : {}),
      ...(server?.settings
        ? { settings: { ...(chatbot.settings ?? {}), ...server.settings } }
        : {}),
      ...(server?.rules ? { rules: server.rules } : {}),
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
        text: said,
        history: dto.history ?? [],
        isFirstMessage,
        ...(tap ? { tap } : {}),
        sender: {
          externalId: `test:${currentUserId()}`,
          label: 'test console',
          userId: me[0]?.id ?? null,
          email: me[0]?.email ?? null,
          tenantId: dto.asTenantId ?? me[0]?.tenant_id ?? null,
        },
        channel: PREVIEW_CHANNEL,
        documentIds: server?.documentIds ?? draft.documentIds,
        conversationId,
      },
      live,
    );

    // Remembered so the setup checklist can show the bot has been tried; Preview stores nothing else.
    // A live chatbot's working-copy test writes nothing to the live row (stage 3).
    if (!server?.readOnly) {
      await this.chatbotRepository.update({ id }, { lastTestedAt: new Date() });
    }

    const reply = isFirstMessage
      ? withFirstMessageParts({
          body: decision.body,
          handledBy: decision.handledBy,
          bodyIsWelcome: decision.isWelcome,
          // Stage 4: the fixed start notice, exactly as a new person receives it.
          notice: startNotice({
            // TF1 P3: Try it is the web page's chat: no "Reply STOP".
            disclaimer: withoutStopLine(
              this.settingsService.renderPlaceholders(
                settings.disclaimerText ?? '',
                settings,
              ),
            ),
            language: replyLanguageOf(dto.message ?? ''),
            organisation: bot.name,
          }),
        })
      : decision.body;

    const result = this.toTestResult(decision, {
      reply,
      conversationId,
      latencyMs: Date.now() - startedAt,
      usedDraft: Boolean(dto.draft),
    });
    result.previewWrite = await this.previewWrote(decision.agent?.runId);
    if (result.previewWrite) {
      // Q4 B4 (Round 6: "All set, booked" in Try it): the reply itself says nothing was saved.
      const line =
        TEST_NOT_SAVED[replyLanguageOf(dto.message ?? '', null)] ??
        TEST_NOT_SAVED.en;
      result.reply = `${result.reply.trim()}\n\n${line}`;
    }
    const remember = wouldRemember(decision);
    if (remember.length) result.wouldRemember = remember;
    // BT1: the same chips and cards as the bot page, built from this run's tool results.
    const language = replyLanguageOf(said ?? '', decision.language);
    const parts = await this.parts?.partsFor({
      chatbotId: id,
      conversationId,
      contactId: null,
      runId: decision.agent?.runId,
      language,
      suppressed:
        decision.handledBy === WaHandledBy.CRISIS ||
        Boolean(decision.blocked) ||
        Boolean(decision.off),
      answered: false,
    });
    if (parts && Object.keys(parts).length) result.parts = parts;
    if (decision.tapDone) {
      result.confirmation = {
        ...decision.tapDone,
        testOnly: TEST_ONLY[language],
      };
    }
    if (tap) result.tapped = said;
    return result;
  }

  /**
   * Whether a Try it run booked or changed something in a list (chunk 5b): Preview checks the
   * write, then rolls it back, so the console says "Test only: this wasn't saved." A failed
   * lookup reads as no write.
   */
  private async previewWrote(runId: string | null | undefined) {
    if (!runId) return false;
    try {
      const rows: unknown[] = await this.chatbotRepository.manager.query(
        `SELECT 1 FROM tool_runs
          WHERE run_id = $1 AND status = $2 AND tool ~ '^(create|update)_'
          LIMIT 1`,
        [runId, ToolRunStatus.OK],
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  /** One Preview test as the console shows it. */
  private toTestResult(
    decision: ChatbotDecision,
    {
      reply,
      conversationId,
      latencyMs,
      usedDraft,
    }: {
      reply: string;
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
        : isFailedRun(agent)
          ? AGENT_RUNTIME_DEGRADED_TYPE
          : null,
      latencyMs,
      usedDraft,
      // Agents v2: which engine answered this test, and the run behind it.
      runtime: agent?.runtime ?? null,
      runId: agent?.runId ?? null,
      trace: agent?.runtime === AgentRuntimeUsed.V2 ? agent.trace : null,
      fallbackReason: isFailedRun(agent) ? agent.fallbackReason : null,
      // What the agent understood the message to be (smalltalk, about_bot, …).
      turnType: decision.turnType ?? null,
      conversationId,
    };
  }
}
