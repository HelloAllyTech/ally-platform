import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AiService } from '../../ai/service/ai.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { ChatbotService } from '../../chatbot/service/chatbot.service';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { BotPageAccess, BotPageStatus } from '../../chatbot/enum/bot-page.enum';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { BotPageSettings } from '../../chatbot/type/bot-page.type';
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

/** "Your instructions" refused because they'd weaken a safety rule (deck §25). */
export const SAFETY_CONFLICT_MESSAGE =
  "That would weaken a safety rule, so it can't be saved. Safety rules always come first.";
/** Saved, but text that tries to override the rules can't (deck §25). */
export const OVERRIDE_WARNING =
  'Saved. Your assistant still follows its safety and base rules first, so text that tries to override them has no effect.';
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
  ) {}

  private readonly logger = LoggerService.getInstance(
    AssistantHomeService.name,
  );

  async get(chatbotId: string) {
    const { chatbot, role } = await this.access.assert(chatbotId);
    const [state, draft] = await Promise.all([
      this.state(chatbot),
      this.drafts.findByChatbot(chatbotId),
    ]);
    const facts = (draft?.learned.facts ?? []).map((fact) => ({
      ...fact,
      version: versionOf(fact.text),
    }));
    return {
      canEdit: role !== ChatbotMemberRole.VIEWER,
      fields: readAll(state),
      safety: safetyView(chatbot.safetyPack, chatbot.rules?.never ?? []),
      facts,
    };
  }

  /**
   * Save one field. `version` is the version of the value the edit started from. Each save is
   * kept in the History (chunk 20d-2) unless the caller records it itself (change by chat).
   */
  async saveField(
    chatbotId: string,
    dto: { field: string; value: unknown; version: string },
    options: { record?: boolean } = {},
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
    const warning =
      dto.field === 'instructions' ? await this.checkInstructions(value) : null;

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
   * rules is saved with a note that it can't. Without ally-ai the save goes ahead: the text is
   * fenced below the base and safety rules either way.
   */
  private async checkInstructions(value: unknown): Promise<string | null> {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || !this.ai) return null;
    const check = await this.ai.checkOwnerText(text).catch(() => null);
    if (check?.refused) {
      throw new UnprocessableEntityException({
        errorCode: 'safety_conflict',
        message: SAFETY_CONFLICT_MESSAGE,
        details: { field: 'instructions' },
      });
    }
    return check?.warning ? OVERRIDE_WARNING : null;
  }

  /** One edit by hand, for the History: who, when, the field, its before and after. */
  private async record(
    chatbotId: string,
    field: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    try {
      const draft = await this.drafts.findByChatbot(chatbotId);
      if (!draft) return;
      await this.drafts.update(draft, {}, [
        {
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: BotDraftActor.OWNER,
          kind: 'edit',
          userId: userId(),
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
      .filter((e) => e.kind === 'edit' || e.kind === 'change')
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
          e.kind === 'edit'
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
  async howItWorks(chatbotId: string) {
    const { chatbot } = await this.access.assert(chatbotId);
    if (!this.ai || !this.chatbots) throw new NotFoundException();
    const request = await this.chatbots.agentRequestFor(chatbotId);
    const instructions = await this.ai.agentInstructions(request);
    return {
      ...instructions,
      purpose: chatbot.purpose ?? null,
      safetyPack: chatbot.safetyPack ?? null,
    };
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
            safety: safetyView(chatbot.safetyPack, own),
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
      return safetyView(chatbot.safetyPack, next);
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
