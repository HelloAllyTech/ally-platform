import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { ChatbotPage } from '../../chatbot/entity/chatbot-page.entity';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { BotPageAccess, BotPageStatus } from '../../chatbot/enum/bot-page.enum';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { BotPageSettings } from '../../chatbot/type/bot-page.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
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
  ) {}

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

  /** Save one field. `version` is the version of the value the edit started from. */
  async saveField(
    chatbotId: string,
    dto: { field: string; value: unknown; version: string },
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

    return this.dataSource.transaction(async (manager) => {
      const chatbot = await this.lock(manager, chatbotId);
      const view = await this.pages.view(chatbot);
      const state: HomeState = { chatbot, page: view.settings };
      const current = field.read(state);
      if (versionOf(current) !== dto.version) {
        throw stale(dto.field, current);
      }
      const write = refusals(dto.field, () => field.write(value, state));
      if (write.chatbot) {
        await manager
          .getRepository(Chatbot)
          .update({ id: chatbotId }, { ...write.chatbot, updatedBy: userId() });
      }
      if (write.page) {
        await this.writePage(manager, chatbot, view, write.page);
      }
      const next: HomeState = {
        chatbot: { ...chatbot, ...(write.chatbot ?? {}) },
        page: { ...view.settings, ...(write.page ?? {}) },
      };
      const saved = field.read(next);
      return { field: dto.field, value: saved, version: versionOf(saved) };
    });
  }

  /** Add, edit or remove one of the owner's own rules. Pack rules are fixed. */
  async changeRule(chatbotId: string, dto: RuleChange & { version: string }) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    return this.dataSource.transaction(async (manager) => {
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
      await manager.getRepository(Chatbot).update(
        { id: chatbotId },
        {
          rules: { ...(chatbot.rules ?? {}), never: next },
          updatedBy: userId(),
        },
      );
      return safetyView(chatbot.safetyPack, next);
    });
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

    const ownerNotes = [draft.draftConfig.ownerNotes.trim(), text]
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

  private async state(chatbot: Chatbot): Promise<HomeState> {
    const view = await this.pages.view(chatbot);
    return { chatbot, page: view.settings };
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
  ): Promise<void> {
    const repository = manager.getRepository(ChatbotPage);
    const existing = await repository.findOne({
      where: { chatbotId: chatbot.id },
    });
    if (existing) {
      await repository.update(
        { id: existing.id },
        {
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
      settings: { ...settings, ...patch } as never,
      createdBy: userId(),
      updatedBy: userId(),
    });
  }
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
