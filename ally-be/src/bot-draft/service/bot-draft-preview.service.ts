import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import { ChatbotReplyService } from '../../chatbot/service/chatbot-reply.service';
import type {
  ChatbotTestOverride,
  ChatbotTestResult,
} from '../../chatbot/service/chatbot.service';
import { settingsHash } from '../working-copy/staged-fields';
import { WorkingCopyService } from '../working-copy/working-copy.service';
import type { BotDraftEntity } from '../entity/bot-draft.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import type { LiveReply } from '../../chatbot/engine/chatbot-engine.types';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ChatbotService } from '../../chatbot/service/chatbot.service';
import type { TestChatbotDto } from '../../chatbot/dto/chatbot.dto';
import { ChatbotDocument } from '../../chatbot/entity/chatbot-document.entity';
import { KbDocumentStatus } from '../../knowledge-base/enum/knowledge-base.enum';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import { BotDraftPublishService } from './bot-draft-publish.service';
import { BotDraftService } from './bot-draft.service';

/**
 * How long a test waits for a just-changed Owner notes or learned-facts document to be searchable.
 * Only documents this projection changed are waited for (never the pages still being read), so an
 * ordinary test waits for nothing. Exported so tests can shorten it.
 */
export const PREVIEW_INDEX_WAIT = { maxMs: 8_000, pollMs: 400 };

/** What the split-build test pane needs to know beyond the reply itself. */
export interface DraftPreviewInfo {
  /**
   * Pages and notes still being indexed. While this is above zero a fresh edit to the owner's
   * notes or the learned facts may not be searchable yet, so the pane says "still learning".
   */
  pendingDocuments: number;
  /**
   * False when an edit to the owner's notes or the learned facts was still being indexed after the
   * wait, so this reply may not use it yet. The pane then offers to ask again.
   */
  editsSearchable: boolean;
  /**
   * Stage 3: a hash of the settings this reply was made with (every staged field, the pack and the
   * documents). The pane marks a reply "older settings" when it differs from the latest edit's.
   */
  settingsHash: string;
  /** When the working copy last changed. */
  settingsUpdatedAt: string | null;
  /** True when the chatbot has gone live: this reply used the working copy, not what customers get. */
  workingCopy: boolean;
  /** True for the blank chatbot's canned starter reply (no model call). */
  starter: boolean;
}

/**
 * The reply a blank chatbot gives before anything is chosen: canned, no model call. A message that
 * matches a crisis keyword still goes through the engine, whose keyword layer is free.
 */
// COPY: needs approval
export const BLANK_STARTER_REPLY =
  "Hi! I'm your new assistant. I don't know anything yet. Pick a template, add your website or documents, or tell me about your organisation, and I'll start answering from that.";

/**
 * SB1: the owner chats with the assistant they are building. While a setup is in progress the
 * draft, not the assistant row, is the owner's source of truth (onboarding edits land on the draft
 * at once), so every test first projects the latest draft onto its DRAFT chatbot, exactly as the
 * checkup does, then runs the ordinary Preview test. The test is the real runtime: same decision
 * path, same crisis check, same safety pack, which this never lets the client change.
 */
@Injectable()
export class BotDraftPreviewService {
  /** One projection at a time per draft: two at once could each create the Owner notes document. */
  private readonly staging = new Map<string, Promise<unknown>>();

  constructor(
    private readonly drafts: BotDraftService,
    private readonly publisher: BotDraftPublishService,
    private readonly chatbots: ChatbotService,
    private readonly access: ChatbotAccessService,
    @InjectRepository(ChatbotDocument)
    private readonly documents: Repository<ChatbotDocument>,
    // Stage 3 (optional, so the specs that build this by hand needn't change).
    @Optional() private readonly workingCopy?: WorkingCopyService,
    @Optional() private readonly replies?: ChatbotReplyService,
  ) {}

  /**
   * Everything a draft test needs before it asks: the draft is ACTIVE and has its assistant, the
   * caller may edit it, the latest draft is projected onto the draft assistant, and the notes and
   * facts documents it changed are searchable (or the wait gave up).
   */
  async prepare(draftId: string): Promise<{
    draft: BotDraftEntity;
    chatbotId: string;
    editsSearchable: boolean;
    override?: ChatbotTestOverride;
  }> {
    const draft = await this.drafts.get(draftId);
    if (!draft.chatbotId) {
      throw new ConflictException({
        errorCode: 'not_ready',
        message: 'This setup has no assistant yet.',
      });
    }
    const finished = draft.status !== BotDraftStatus.ACTIVE;
    if (
      draft.status === BotDraftStatus.ABANDONED ||
      (finished && !this.workingCopy)
    ) {
      // A finished setup is edited from the assistant's home, which writes the assistant itself.
      // Projecting an old draft over it would undo those edits.
      throw new ConflictException({
        errorCode: 'setup_finished',
        message: 'This setup is finished. Try the assistant from its home.',
      });
    }
    const chatbotId = draft.chatbotId;
    const { chatbot } = (await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    )) as { chatbot?: Parameters<typeof WorkingCopyService.isLive>[1] };
    // Stage 3 (plan section 3, "Config model"): once the chatbot has gone live, the test runs the
    // working copy as a server-side override and writes nothing to the live chatbot.
    if (
      this.workingCopy &&
      (finished ||
        WorkingCopyService.isLive(
          draft,
          chatbot ?? { status: 'draft' as never },
        ))
    ) {
      const ctx = { draft, chatbot: chatbot as never, live: true };
      const {
        override,
        waitFor,
        draft: synced,
      } = await this.workingCopy.testOverride(ctx);
      const editsSearchable = await this.waitForDocuments(waitFor);
      return { draft: synced, chatbotId, editsSearchable, override };
    }
    // Before go-live: the draft is projected onto its chatbot, as it always was.
    await this.stageOnce(draftId, () => this.publisher.stage(draft));
    // The projection may have rewritten the notes or facts document; they are searchable only once
    // re-indexed, so wait (briefly) for exactly those, so an edit is live for this very reply.
    const editsSearchable = await this.waitForEdits(draftId);
    return { draft, chatbotId, editsSearchable };
  }

  async test(draftId: string, dto: TestChatbotDto, live?: LiveReply) {
    const peek = await this.drafts.get(draftId);
    // A test message is a meaningful action: a blank is touched by it (never swept after).
    if (this.workingCopy) await this.drafts.touch?.(peek.id);
    const starter = await this.starterReply(peek, dto);
    if (starter) return starter;
    const { chatbotId, editsSearchable, override, draft } =
      await this.prepare(draftId);
    // The server's draft is the truth: an override sent from the browser is ignored here.
    const result = override
      ? await this.chatbots.test(
          chatbotId,
          { ...dto, draft: undefined },
          live,
          override,
        )
      : await this.chatbots.test(chatbotId, { ...dto, draft: undefined }, live);
    const preview: DraftPreviewInfo = {
      pendingDocuments: await this.pendingDocuments(chatbotId),
      editsSearchable,
      ...this.settingsInfo(draft, Boolean(override), false),
    };
    return { ...result, preview };
  }

  private settingsInfo(
    draft: BotDraftEntity,
    workingCopy: boolean,
    starter: boolean,
  ) {
    return {
      settingsHash: draft.draftConfig
        ? settingsHash(
            draft.draftConfig,
            draft.source?.pendingDocumentIds ?? [],
          )
        : '',
      settingsUpdatedAt: draft.updatedAt
        ? new Date(draft.updatedAt).toISOString()
        : null,
      workingCopy,
      starter,
    };
  }

  /**
   * A blank chatbot with nothing chosen yet answers with a canned starter reply and no model call.
   * Null when the chatbot has something to answer from, or when the message matches a crisis
   * keyword (the engine's free keyword layer then answers, as on every channel).
   */
  private async starterReply(
    draft: BotDraftEntity,
    dto: TestChatbotDto,
  ): Promise<(ChatbotTestResult & { preview: DraftPreviewInfo }) | null> {
    if (!this.workingCopy || !draft.blank || !draft.chatbotId) return null;
    if (draft.status === BotDraftStatus.ABANDONED) return null;
    const config = draft.draftConfig;
    const hasContent =
      Boolean(draft.source?.template) ||
      Boolean(draft.source?.website) ||
      (config?.knowledgeDocumentIds ?? []).length > 0 ||
      Boolean(config?.instructions?.trim()) ||
      Boolean(config?.ownerNotes?.trim()) ||
      (draft.learned?.facts ?? []).length > 0;
    if (hasContent) return null;
    await this.access.assert(draft.chatbotId, ChatbotMemberRole.EDITOR);
    const crisis = await this.replies
      ?.isCrisisKeyword(dto.message, null, draft.chatbotId)
      .catch(() => true);
    // Unknown (no reply service) or a match: let the engine answer it.
    if (crisis !== false) return null;
    return {
      reply: BLANK_STARTER_REPLY,
      handledBy: WaHandledBy.TEMPLATE,
      citations: [],
      retrieval: null,
      language: null,
      wouldFileUnanswered: null,
      wouldAlert: null,
      latencyMs: 0,
      usedDraft: false,
      runtime: null,
      runId: null,
      trace: null,
      fallbackReason: null,
      turnType: null,
      conversationId: dto.conversationId ?? `preview-${randomUUID()}`,
      preview: {
        pendingDocuments: 0,
        editsSearchable: true,
        ...this.settingsInfo(draft, false, true),
      },
    };
  }

  /** True when these documents are searchable (or there are none, or no way to tell). */
  private async waitForDocuments(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    try {
      const deadline = Date.now() + PREVIEW_INDEX_WAIT.maxMs;
      for (;;) {
        const rows: { status: string }[] = await this.documents.manager.query(
          `SELECT status FROM kb_documents WHERE id = ANY($1)`,
          [ids],
        );
        if (rows.every((row) => row.status === KbDocumentStatus.INDEXED)) {
          return true;
        }
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) =>
          setTimeout(resolve, PREVIEW_INDEX_WAIT.pollMs),
        );
      }
    } catch {
      return true;
    }
  }

  /** True when the notes and facts documents are searchable (or there are none, or no way to tell). */
  private async waitForEdits(draftId: string): Promise<boolean> {
    try {
      const fresh = await this.drafts.get(draftId);
      const ids = [
        fresh.source?.ownerNotesDocumentId,
        fresh.source?.learnedFactsDocumentId,
      ].filter((id): id is string => Boolean(id));
      if (!ids.length) return true;
      const deadline = Date.now() + PREVIEW_INDEX_WAIT.maxMs;
      for (;;) {
        const rows: { status: string }[] = await this.documents.manager.query(
          `SELECT status FROM kb_documents WHERE id = ANY($1)`,
          [ids],
        );
        if (rows.every((row) => row.status === KbDocumentStatus.INDEXED)) {
          return true;
        }
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) =>
          setTimeout(resolve, PREVIEW_INDEX_WAIT.pollMs),
        );
      }
    } catch {
      // Never fail a test over the wait.
      return true;
    }
  }

  private async stageOnce(
    draftId: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    const previous = this.staging.get(draftId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.staging.set(draftId, next);
    try {
      await next;
    } finally {
      if (this.staging.get(draftId) === next) this.staging.delete(draftId);
    }
  }

  private async pendingDocuments(chatbotId: string): Promise<number> {
    try {
      const rows: { pending: string }[] = await this.documents.manager.query(
        `SELECT count(*) AS pending
           FROM chatbot_documents cd
           JOIN kb_documents d ON d.id = cd.document_id
          WHERE cd.chatbot_id = $1 AND d.archived_at IS NULL AND d.status <> $2`,
        [chatbotId, KbDocumentStatus.INDEXED],
      );
      return Number(rows[0]?.pending ?? 0);
    } catch {
      // A failed count must never fail the test.
      return 0;
    }
  }
}
