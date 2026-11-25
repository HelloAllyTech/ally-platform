import { syncDraftPack } from '../safety-pack/sync-draft-pack';
import { knowledgeStalenessOf } from '../../chatbot/knowledge/knowledge-freshness.service';
import { GoLiveGateService } from '../../chatbot/safety/go-live-gate.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { crisisHelplines } from '../../chatbot/engine/crisis-helplines';
import { ListToolsService } from '../../chatbot/agent-tools/list-tools.service';
import type { ListPlaybook } from '../../chatbot/agent-tools/list-tools';
import { InjectDataSource } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHATBOT_ACTIVITY,
  type ChatbotActivityEvent,
} from '../../chatbot/type/chatbot-activity';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AiService } from '../../ai/service/ai.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { ChatbotSettingsService } from '../../chatbot/service/chatbot-settings.service';
import { ChatbotService } from '../../chatbot/service/chatbot.service';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import { Chatbot, type PackChange } from '../../chatbot/entity/chatbot.entity';
import {
  crisisReply,
  MIN_PACK_REASON,
  packFor,
} from '../safety-pack/safety-packs';
import { BotPageAccess, BotPageStatus } from '../../chatbot/enum/bot-page.enum';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { BotPageSettings } from '../../chatbot/type/bot-page.type';
import type { ChatbotSettingsOverride } from '../../chatbot/type/chatbot.type';
import {
  abilityFor,
  isIndiaAssistant,
  listToolName,
} from '../../chatbot/agent-tools/list-tools';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor } from '../enum/bot-draft.enum';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { BotDraftService, FACT_MAX_CHARS } from '../service/bot-draft.service';
import type {
  DraftEvent,
  FactCorrection,
  LearnedFact,
} from '../type/bot-draft.type';
import { replaceSource } from './correction';
import {
  homeField,
  HomeFieldInvalid,
  HomeState,
  readAll,
  versionOf,
} from './home-fields';
import { changeOwnRules, RuleChange, safetyView } from './own-rules';

/** The shortest reason the owner can give for a less strict pack (Q3-fast Part 1). */

/** "Your instructions" refused because they'd weaken a safety rule (deck §25). */
export const SAFETY_CONFLICT_MESSAGE =
  "That would weaken a safety rule, so it can't be saved. Safety rules always come first.";
/** Saved, but text that tries to override the rules can't (deck §25). */
export const OVERRIDE_WARNING =
  'Saved. Your assistant still follows its safety and base rules first, so text that tries to override them has no effect.';
/** "Your instructions" couldn't be checked, so they weren't saved (deck §25). */
export const CHECK_UNAVAILABLE_MESSAGE =
  "Couldn't check this right now. Try again in a minute.";
/** How many changes the History shows. */
const HISTORY_SHOWN = 50;

/** Shown when a save was based on a value that changed since (two tabs, or two people). */
export const STALE_MESSAGE =
  'This changed while you were editing. Here is what it says now.';

/**
 * The assistant home's API (chunk 20d): one load of everything an owner edits, a save per field
 * (refused when stale), the owner's own safety rules, and corrections to what was learned.
 *
 * Saves of one bot are serialised by a row lock on the bot, so the stale check and the write can't
 * interleave with another save.
 */
@Injectable()
export class AssistantHomeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly pages: BotPageService,
    private readonly drafts: BotDraftService,
    private readonly publisher: BotDraftPublishService,
    private readonly knowledge: KnowledgeBaseService,
    // Chunk 20d-2 (optional, so the specs that build this service by hand needn't change).
    private readonly ai?: AiService,
    private readonly chatbots?: ChatbotService,
    private readonly settings?: ChatbotSettingsService,
    // Q3-fast Part 2b: How it works names each list's playbook.
    @Optional() private readonly listToolsService?: ListToolsService,
    // Stage 4: the go-live gate on the page toggle (D10). Optional for the specs.
    @Optional() private readonly goLive?: GoLiveGateService,
  ) {}

  private readonly logger = LoggerService.getInstance(
    AssistantHomeService.name,
  );

  async get(chatbotId: string) {
    const { chatbot, role } = await this.access.assert(chatbotId);
    const [state, draft, atRiskReply, staleness] = await Promise.all([
      this.state(chatbot),
      this.drafts.findByChatbot(chatbotId),
      this.atRiskReply(chatbot),
      // Stage 5: days since the oldest source was read, and the nudge past 30.
      knowledgeStalenessOf(this.dataSource, chatbotId).catch(() => ({
        knowledgeStaleDays: null,
        knowledgeStaleNudge: false,
      })),
    ]);
    const facts = (draft?.learned.facts ?? []).map((fact) => ({
      ...fact,
      version: versionOf(fact.text),
    }));
    return {
      // A removed assistant is read-only.
      canEdit: role !== ChatbotMemberRole.VIEWER && !chatbot.archivedAt,
      fields: readAll(state),
      safety: {
        ...safetyView(
          // TF1 round 2 (Saathi B-6): before go-live the pack is only on the working copy, so
          // Settings showed no pack at all; it names the pack the assistant will go live with.
          chatbot.safetyPack ?? draft?.safetyPack ?? null,
          chatbot.rules?.never ?? [],
          chatbot.rules?.packChange ?? null,
        ),
        atRiskReply,
      },
      facts,
      ...staleness,
    };
  }

  /**
   * Save one field. `version` is the version of the value the edit started from. Each save is
   * kept in the History (chunk 20d-2) unless the caller records it itself (change by chat).
   */
  async saveField(
    chatbotId: string,
    dto: { field: string; value: unknown; version: string },
    options: {
      record?: boolean;
      /**
       * Stage 3 Apply: the staged change already passed the Apply safety check (which fails
       * closed), so the instruction check is not run, and paid for, a second time.
       */
      checked?: boolean;
    } = {},
  ) {
    const field = homeField(dto.field);
    if (!field) {
      throw new BadRequestException({
        errorCode: 'unknown_field',
        message: `"${dto.field}" can't be changed here.`,
      });
    }
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const value = refusals(dto.field, () => field.parse(dto.value));
    // Stage 4: turning the page on makes the assistant live, so it passes the go-live gate first.
    if (dto.field === 'pageStatus' && value === BotPageStatus.ON) {
      await this.goLive?.assertCanGoLive(chatbotId);
    }
    const warning =
      dto.field === 'instructions' && !options.checked
        ? await this.checkInstructions(value)
        : null;

    let before: unknown;
    const saved = await this.dataSource.transaction(async (manager) => {
      const chatbot = await this.lock(manager, chatbotId);
      const view = await this.pages.view(chatbot);
      const state = stateOf(chatbot, view);
      const current = field.read(state);
      if (versionOf(current) !== dto.version) {
        throw stale(dto.field, current);
      }
      before = current;
      const write = refusals(dto.field, () => field.write(value, state));
      if (write.chatbot) {
        await manager
          .getRepository(Chatbot)
          .update({ id: chatbotId }, { ...write.chatbot, updatedBy: userId() });
      }
      if (write.page || write.pageRow) {
        await this.writePage(
          manager,
          chatbot,
          view,
          write.page ?? {},
          write.pageRow ?? {},
        );
      }
      const next: HomeState = {
        ...state,
        chatbot: { ...chatbot, ...(write.chatbot ?? {}) },
        page: { ...view.settings, ...(write.page ?? {}) },
        pageRow: { ...state.pageRow, ...(write.pageRow ?? {}) },
      };
      const saved = field.read(next);
      return { field: dto.field, value: saved, version: versionOf(saved) };
    });
    if (options.record !== false && versionOf(before) !== saved.version) {
      await this.record(chatbotId, dto.field, before, saved.value);
    }
    return warning ? { ...saved, warning } : saved;
  }

  /**
   * "Your instructions" go through the builder's safety check too (chunk 20d-2): text that
   * would weaken a safety rule is refused with the reason; text that tries to override the
   * rules is saved with a note that it can't. If the check can't be reached, nothing is saved.
   */
  /**
   * The reply someone who may be at risk gets when the owner hasn't written their own, exactly as
   * the engine sends it (`crisisReply`): this bot's own helpline numbers first, then the
   * findahelpline.com link (R6, stage 4). Q3-fast (gaps item 10): it showed the platform's old template, "your local crisis
   * line", while customers got the numbers.
   */
  private async atRiskReply(chatbot: Chatbot): Promise<string | null> {
    if (!this.settings) return null;
    const effective = await this.settings.getForChatbot(chatbot);
    return crisisReply({
      pack: chatbot.safetyPack,
      // Q4 G7: exactly what's sent, so only a number the owner confirmed.
      helplineNumbers: crisisHelplines(effective),
      india: isIndiaAssistant(chatbot.settings),
    });
  }

  private async checkInstructions(value: unknown): Promise<string | null> {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    // Fail closed (chunk 20d-2, at approval): unchecked text is never saved.
    const check = this.ai
      ? await this.ai.checkOwnerText(text).catch(() => null)
      : null;
    if (!check) {
      throw new ServiceUnavailableException({
        errorCode: 'check_unavailable',
        message: CHECK_UNAVAILABLE_MESSAGE,
        details: { field: 'instructions' },
      });
    }
    if (check.refused) {
      throw new UnprocessableEntityException({
        errorCode: 'safety_conflict',
        message: SAFETY_CONFLICT_MESSAGE,
        details: { field: 'instructions' },
      });
    }
    return check.warning ? OVERRIDE_WARNING : null;
  }

  /**
   * TF1 round 2: going live, pausing, an access-list removal and a helpline confirmation, made
   * elsewhere, are listed in the History too (as `activity`, never undone).
   */
  @OnEvent(CHATBOT_ACTIVITY, { async: true })
  async onActivity(event: ChatbotActivityEvent): Promise<void> {
    await this.record(
      event.chatbotId,
      event.field,
      event.before ?? null,
      event.after ?? null,
      'activity',
      event.userId,
    );
  }

  /** One edit by hand, for the History: who, when, the field, its before and after. */
  private async record(
    chatbotId: string,
    field: string,
    before: unknown,
    after: unknown,
    kind: 'edit' | 'activity' = 'edit',
    by?: number | null,
  ): Promise<void> {
    try {
      const draft = await this.drafts.findByChatbot(chatbotId);
      if (!draft) return;
      await this.drafts.update(draft, {}, [
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: BotDraftActor.OWNER,
          kind,
          userId: by ?? userId(),
          origin: 'hand',
          field,
          before,
          after,
          summary: field,
        },
      ]);
    } catch (error) {
      // The History misses one line; the save itself already happened.
      this.logger.warn(
        `Couldn't record an edit to ${field} for ${chatbotId}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  /**
   * The History (chunk 20d-2): every change, newest first, what, who, when and where from (the
   * Change panel or by hand), with the before and after of each field.
   */
  async history(chatbotId: string) {
    await this.access.assert(chatbotId);
    const draft = await this.drafts.findByChatbot(chatbotId);
    const events = (draft?.events ?? [])
      .filter(
        (e) =>
          e.kind === 'edit' || e.kind === 'change' || e.kind === 'activity',
      )
      .slice(-HISTORY_SHOWN)
      .reverse();
    const ids = [
      ...new Set(
        events.map((e) => e.userId).filter((id): id is number => !!id),
      ),
    ];
    const names = new Map<number, string>();
    if (ids.length) {
      const rows: { id: number; name: string | null }[] =
        await this.dataSource.query(
          `SELECT id, name FROM users WHERE id = ANY($1::int[])`,
          [ids],
        );
      for (const row of rows) if (row.name) names.set(row.id, row.name);
    }
    return {
      entries: events.map((e) => ({
        id: e.id,
        at: e.at,
        kind: e.kind,
        origin: e.origin ?? (e.kind === 'change' ? 'panel' : 'hand'),
        who: e.userId ? (names.get(e.userId) ?? null) : null,
        fields:
          e.kind === 'edit' || e.kind === 'activity'
            ? [{ field: e.field ?? '', before: e.before, after: e.after }]
            : (e.ops ?? []).map((op) => op.value as never),
        undone: Boolean(e.undoneBy),
      })),
    };
  }

  /**
   * Undo an edit by hand (its before comes back) or Restore one (its after comes back), as a
   * new save with the field's current version, so it shows in the History too.
   */
  async revertEdit(chatbotId: string, eventId: string, to: 'before' | 'after') {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.drafts.findByChatbot(chatbotId);
    const event = draft?.events.find(
      (e) => e.id === eventId && e.kind === 'edit',
    );
    if (!event?.field || !homeField(event.field)) {
      throw new NotFoundException('That change was not found.');
    }
    const view = await this.get(chatbotId);
    const current = (
      view.fields as Record<string, { value: unknown; version: string }>
    )[event.field];
    return this.saveField(chatbotId, {
      field: event.field,
      value: to === 'before' ? event.before : event.after,
      version: current.version,
    });
  }

  /**
   * "How it works" (chunk 20d-2): the instructions this assistant follows, built by ally-ai from
   * the very request a v2 answer would send (`ChatbotService.agentRequestFor`). Nothing is kept.
   */
  /** The Overview's numbers over the last 7 or 30 days. */
  async numbers(chatbotId: string, days: 7 | 30) {
    await this.access.assert(chatbotId);
    if (!this.chatbots) throw new NotFoundException();
    return { days, ...(await this.chatbots.statsFor(chatbotId, days)) };
  }

  async howItWorks(chatbotId: string) {
    const { chatbot } = await this.access.assert(chatbotId);
    if (!this.ai || !this.chatbots) throw new NotFoundException();
    const request = await this.chatbots.agentRequestFor(chatbotId);
    const instructions = await this.ai.agentInstructions(request);
    return {
      // Ally's own layers go out as a layer name only: their text, the whole prompt and its
      // placeholders stay on the server, for everyone (Shehbaz, 17 Nov 2026). The owner's own
      // parts keep their exact text.
      parts: (instructions.parts ?? []).map((part) =>
        part.owner ? part : { ...part, text: '' },
      ),
      search: instructions.search,
      purpose: chatbot.purpose ?? null,
      safetyPack: chatbot.safetyPack ?? null,
      bookingLists: await this.bookingLists(chatbotId, chatbot.settings),
      tools: await this.listTools(chatbotId, chatbot.settings),
      playbooks: await this.playbooks(chatbotId, chatbot.settings),
    };
  }

  /**
   * Each list's playbook (Q3-fast Part 2b), as a run gets it: "Because you added Appointments, your
   * assistant finds free times, confirms the exact time and books it." One per list.
   */
  private async playbooks(
    chatbotId: string,
    stored: ChatbotSettingsOverride | null | undefined,
  ): Promise<{ list: string; kind: ListPlaybook }[]> {
    if (!this.listToolsService) return [];
    try {
      const { definitions } = await this.listToolsService.offeredFor(
        chatbotId,
        stored,
        { knowsPerson: true },
      );
      const byList = new Map<string, ListPlaybook>();
      for (const def of definitions) {
        if (def.playbook && def.list_name)
          byList.set(def.list_name, def.playbook);
      }
      return [...byList].map(([list, kind]) => ({ list, kind }));
    } catch {
      return [];
    }
  }

  /**
   * What the assistant can do with each list, as the tools a run is offered: find when the list
   * lets it read, add and change when it lets it write, each only when its ability is Do it.
   */
  private async listTools(
    chatbotId: string,
    stored: ChatbotSettingsOverride | null | undefined,
  ): Promise<{ list: string; can: ('find' | 'create' | 'update')[] }[]> {
    const lists: {
      key: string;
      name: string;
      agent_read: boolean;
      agent_write: boolean;
    }[] = await this.dataSource.query(
      `SELECT key, name, agent_read, agent_write FROM collections
        WHERE chatbot_id = $1 AND deleted_at IS NULL
        ORDER BY "createdAt"`,
      [chatbotId],
    );
    return lists
      .map((list) => {
        const kinds: ('find' | 'create' | 'update')[] = [
          ...(list.agent_read ? (['find'] as const) : []),
          ...(list.agent_write ? (['create', 'update'] as const) : []),
        ];
        return {
          list: list.name,
          can: kinds.filter(
            (kind) =>
              abilityFor(stored, listToolName(kind, list.key)) === 'do_it',
          ),
        };
      })
      .filter((tool) => tool.can.length > 0);
  }

  /**
   * The lists the assistant adds entries to (chunk 5b): Add is Do it and the list lets it write.
   * The purpose's honest limit then reads "It books into your {list} list."
   */
  private async bookingLists(
    chatbotId: string,
    stored: ChatbotSettingsOverride | null | undefined,
  ): Promise<string[]> {
    const lists: { key: string; name: string }[] = await this.dataSource.query(
      `SELECT key, name FROM collections
        WHERE chatbot_id = $1 AND deleted_at IS NULL AND agent_write
        ORDER BY "createdAt"`,
      [chatbotId],
    );
    return lists
      .filter(
        (list) =>
          abilityFor(stored, listToolName('create', list.key)) === 'do_it',
      )
      .map((list) => list.name);
  }

  /**
   * The owner corrects the safety pack (Q3-fast Part 1, C10: a restaurant given Care for young
   * people, a lab given Mental health). An equally strict or stricter pack applies at once; a less
   * strict one needs the owner's reason, is logged, and the Checkup says so. Owners only, and only
   * here: the setup chat still refuses to weaken a pack, so nothing a conversation says can.
   */
  async changePack(chatbotId: string, dto: { pack: string; reason?: string }) {
    await this.access.assert(chatbotId, ChatbotMemberRole.OWNER);
    const next = packFor(dto.pack);
    if (!next) {
      throw new BadRequestException({
        errorCode: 'invalid_pack',
        message: "That isn't one of the safety packs.",
      });
    }
    let change: PackChange | null = null;
    const view = await this.dataSource.transaction(async (manager) => {
      const chatbot = await this.lock(manager, chatbotId);
      const was = packFor(chatbot.safetyPack);
      if (was?.id === next.id) {
        return safetyView(
          chatbot.safetyPack,
          chatbot.rules?.never ?? [],
          chatbot.rules?.packChange ?? null,
        );
      }
      const lessStrict = Boolean(was && next.strength < was.strength);
      const reason = (dto.reason ?? '').trim();
      if (lessStrict && reason.length < MIN_PACK_REASON) {
        throw new BadRequestException({
          errorCode: 'reason_required',
          message: `${next.name} is less strict than ${was!.name}. Say why it's right for your business.`,
        });
      }
      change = {
        from: was?.id ?? null,
        to: next.id,
        reason: lessStrict ? reason.slice(0, 300) : null,
        lessStrict,
        at: new Date().toISOString(),
        by: userId() ?? null,
      };
      await manager.getRepository(Chatbot).update(
        { id: chatbotId },
        {
          safetyPack: next.id,
          safetyPackVersion: next.version,
          rules: { ...(chatbot.rules ?? { never: [] }), packChange: change },
          updatedBy: userId(),
        },
      );
      await syncDraftPack(manager, chatbotId, next.id, change);
      return safetyView(next.id, chatbot.rules?.never ?? [], change);
    });
    if (change) {
      const made = change as PackChange;
      // The reason stays in the record; the log names only the move.
      this.logger.warn(
        `Safety pack changed by the owner on chatbot ${chatbotId}: ${made.from ?? 'none'} → ` +
          `${made.to}${made.lessStrict ? ' (less strict, with a reason)' : ''}`,
      );
      await this.record(chatbotId, 'safetyPack', made.from, made.to);
    }
    return view;
  }

  /** Add, edit or remove one of the owner's own rules. Pack rules are fixed. */
  async changeRule(
    chatbotId: string,
    dto: RuleChange & { version: string },
    options: { record?: boolean } = {},
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    let before: string[] = [];
    let after: string[] = [];
    const view = await this.dataSource.transaction(async (manager) => {
      const chatbot = await this.lock(manager, chatbotId);
      const own = chatbot.rules?.never ?? [];
      if (versionOf(own) !== dto.version) {
        throw new ConflictException({
          errorCode: 'stale',
          message: STALE_MESSAGE,
          details: {
            field: 'rules',
            safety: safetyView(
              chatbot.safetyPack,
              own,
              chatbot.rules?.packChange ?? null,
            ),
          },
        });
      }
      const next = refusals('rules', () => changeOwnRules(own, dto));
      before = own;
      after = next;
      await manager.getRepository(Chatbot).update(
        { id: chatbotId },
        {
          rules: { ...(chatbot.rules ?? {}), never: next },
          updatedBy: userId(),
        },
      );
      return safetyView(
        chatbot.safetyPack,
        next,
        chatbot.rules?.packChange ?? null,
      );
    });
    // In the History as "Your own rules"; undone by editing the rule again, not from there.
    if (options.record !== false) {
      await this.record(chatbotId, 'rules', before, after);
    }
    return view;
  }

  /**
   * Correct a learned fact. The correction replaces the original for the assistant: its sentence
   * in the page's text is replaced (and the page re-indexed), so the original is no longer found;
   * where no sentence matches, the correction goes into the owner's notes only. Either way it is
   * added to the owner's notes, linked from the fact, which keeps the original for "Show original".
   */
  async correctFact(
    chatbotId: string,
    factId: string,
    dto: { text: string; version: string },
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.drafts.findByChatbot(chatbotId);
    const index = draft?.learned.facts.findIndex((f) => f.id === factId) ?? -1;
    if (!draft || index < 0) throw new NotFoundException('Detail not found');
    const fact = draft.learned.facts[index] as LearnedFact;
    if (versionOf(fact.text) !== dto.version) {
      throw new ConflictException({
        errorCode: 'stale',
        message: STALE_MESSAGE,
        details: {
          field: 'fact',
          value: fact.text,
          version: versionOf(fact.text),
        },
      });
    }
    const text = (dto.text ?? '').trim();
    if (!text || text.length > FACT_MAX_CHARS) {
      throw new BadRequestException({
        errorCode: 'invalid_value',
        message: `Write the correction in up to ${FACT_MAX_CHARS} characters.`,
        details: { field: 'fact' },
      });
    }
    const originalText = fact.correction?.originalText ?? fact.text;

    // Replace the sentence the fact came from in its page, matched against what that page says
    // now (an earlier correction may already have replaced it).
    const documentId =
      fact.correction?.documentId ??
      draft.crawl?.pages.find((p) => p.url === fact.sourceUrl && p.documentId)
        ?.documentId ??
      null;
    let appliedTo: FactCorrection['appliedTo'] = 'notes';
    let pageHash: string | null = null;
    if (documentId) {
      const document = await this.knowledge.getForChatbot(documentId);
      const pageText = document.rawText ?? '';
      pageHash = fact.correction?.pageHash ?? hash(pageText);
      const replaced = replaceSource(pageText, fact.text, text);
      if (replaced !== null) {
        await this.knowledge.updateForChatbot(chatbotId, documentId, {
          text: replaced,
        });
        appliedTo = 'page';
      }
    }

    // The notes as they stand: the home edits the Owner notes document directly, so it, not the
    // draft's copy, is the latest.
    const ownerNotes = [(await this.currentNotes(draft)).trim(), text]
      .filter(Boolean)
      .join('\n');
    const notesDocumentId = await this.publisher.ownerNotes(draft, {
      ownerNotes,
    });

    const correction: FactCorrection = {
      text,
      originalText,
      appliedTo,
      documentId: appliedTo === 'page' ? documentId : null,
      notesDocumentId,
      pageHash,
      at: new Date().toISOString(),
    };
    const corrected: LearnedFact = { ...fact, text, byOwner: true, correction };
    const facts = draft.learned.facts.map((f, n) =>
      n === index ? corrected : f,
    );
    const event: DraftEvent = {
      id: randomUUID(),
      at: correction.at,
      actor: BotDraftActor.OWNER,
      kind: 'patch',
      target: 'learned',
      ops: [{ op: 'replace', path: `/facts/${index}`, value: corrected }],
      inverse: [{ op: 'replace', path: `/facts/${index}`, value: fact }],
      summary: 'Corrected a detail',
    };
    await this.drafts.update(
      draft,
      {
        learned: { ...draft.learned, facts },
        draftConfig: { ...draft.draftConfig, ownerNotes },
        source: { ...draft.source, ownerNotesDocumentId: notesDocumentId },
      },
      [event],
    );
    return { fact: { ...corrected, version: versionOf(text) }, appliedTo };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async currentNotes(draft: BotDraftEntity): Promise<string> {
    const id = draft.source?.ownerNotesDocumentId;
    if (!id) return draft.draftConfig.ownerNotes;
    try {
      const document = await this.knowledge.getForChatbot(id);
      return document.isArchived ? '' : (document.rawText ?? '');
    } catch {
      return draft.draftConfig.ownerNotes;
    }
  }

  private async state(chatbot: Chatbot): Promise<HomeState> {
    return stateOf(chatbot, await this.pages.view(chatbot));
  }

  private async lock(
    manager: EntityManager,
    chatbotId: string,
  ): Promise<Chatbot> {
    const chatbot = await manager.getRepository(Chatbot).findOne({
      where: { id: chatbotId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!chatbot) throw new NotFoundException('Chatbot not found');
    return chatbot;
  }

  /**
   * Merge keys into the page's stored settings. A bot without a page yet gets one, off and
   * invite-only, at its suggested link: the same page the Page section turns on later.
   */
  private async writePage(
    manager: EntityManager,
    chatbot: Chatbot,
    view: { saved: boolean; slug: string; settings: BotPageSettings },
    patch: Partial<BotPageSettings>,
    row: Partial<HomeState['pageRow']>,
  ): Promise<void> {
    const repository = manager.getRepository(ChatbotPage);
    const existing = await repository.findOne({
      where: { chatbotId: chatbot.id },
    });
    if (existing) {
      await repository.update(
        { id: existing.id },
        {
          ...row,
          settings: { ...existing.settings, ...patch } as never,
          updatedBy: userId(),
        },
      );
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { brand: _defaults, ...settings } = view.settings;
    await repository.insert({
      chatbotId: chatbot.id,
      slug: view.slug,
      status: BotPageStatus.OFF,
      access: BotPageAccess.INVITE,
      ...row,
      settings: { ...settings, ...patch } as never,
      createdBy: userId(),
      updatedBy: userId(),
    });
  }
}

function stateOf(
  chatbot: Chatbot,
  view: {
    settings: BotPageSettings;
    status: BotPageStatus;
    access: BotPageAccess;
    publicAllowed: boolean;
  },
): HomeState {
  return {
    chatbot,
    page: view.settings,
    pageRow: { status: view.status, access: view.access },
    publicAllowed: view.publicAllowed,
  };
}

function userId(): number | null {
  return Number(ExecutionManager.getUserId() ?? 0) || null;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function stale(field: string, current: unknown): ConflictException {
  return new ConflictException({
    errorCode: 'stale',
    message: STALE_MESSAGE,
    details: { field, value: current, version: versionOf(current) },
  });
}

/** A field's own refusals as 400s the home shows under the field. */
function refusals<T>(field: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SafetyLockedError) {
      throw new BadRequestException({
        errorCode: error.code,
        message: error.message,
        details: { field, reason: error.reason },
      });
    }
    if (error instanceof HomeFieldInvalid) {
      throw new BadRequestException({
        errorCode: 'invalid_value',
        message: error.message,
        details: { field },
      });
    }
    throw error;
  }
}
