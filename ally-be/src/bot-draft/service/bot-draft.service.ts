import { realName } from '../name-placeholders';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotMember } from '../../chatbot/entity/chatbot-member.entity';
import {
  ChatbotMemberRole,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import { DEFAULT_ACCENT_COLOUR } from '../../chatbot/type/bot-page.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { BotDraftDto } from '../dto/bot-draft.dto';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftActor,
  BotDraftStatus,
  BotDraftStep,
  LearnedSection,
  PurposeId,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import {
  assertDraftKeepsPack,
  SafetyLockedError,
} from '../safety-pack/safety-lock';
import {
  MIN_PACK_REASON,
  packFor,
  packForStaff,
  sectorPackOnStaff,
  STAFF_PACK_REASON,
} from '../safety-pack/safety-packs';
import { isPlaceholder, NAME_PATHS } from '../name-placeholders';
import { LoggerService } from '../../logger/logger.service';
import {
  LEARNED_FACTS_CHANGED,
  type LearnedFactsChanged,
} from './learned-facts-document';
import type {
  BotDraft,
  DraftEvent,
  Learned,
  LearnedFact,
  PatchOp,
  TranscriptEntry,
} from '../type/bot-draft.type';
import { BotDraftEventsService } from './bot-draft-events.service';
import { QuickReplyCopyService } from '../../chatbot/quick-replies/quick-reply-copy.service';
import {
  applyPatch,
  PatchError,
  pathAllowed,
  pathsOverlap,
} from './json-patch';
import { canAdvance, previousStep } from './step-machine';

/**
 * What each actor may change in the draft. The builder proposes text and structure; only the owner
 * chooses who can use the assistant or adds their own rules; nobody patches the documents or the
 * pack (the server sets those).
 */
const DRAFT_PATHS: Record<BotDraftActor, readonly string[]> = {
  [BotDraftActor.BUILDER]: [
    '/name',
    '/assistantName',
    '/introduction',
    '/instructions',
    '/tone',
    '/languages',
    '/topics',
    '/ownerNotes',
    '/suggestedQuestions',
    '/prechat',
    '/declineText',
    '/branding',
    '/design',
    '/purpose',
    '/purposeNote',
  ],
  [BotDraftActor.OWNER]: [
    '/name',
    '/assistantName',
    '/introduction',
    '/instructions',
    '/tone',
    '/languages',
    '/topics',
    '/ownerNotes',
    '/suggestedQuestions',
    '/prechat',
    '/declineText',
    '/extraNever',
    '/branding',
    '/access',
    '/design',
    '/purpose',
    '/purposeNote',
  ],
  // The server itself (undo, the crawl) isn't limited to these lists.
  [BotDraftActor.SYSTEM]: [],
};

const SECTIONS = new Set<string>(Object.values(LearnedSection));
export const FACT_MAX_CHARS = 500;
/** The source of a fact the owner told us themselves. */
export const OWNER_SOURCE = 'owner';

export class DraftPatchRefused extends BadRequestException {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({ errorCode: code, message, details });
  }
}

/**
 * The onboarding draft and everything that changes it (chunk 20a). The builder in ally-ai only
 * proposes; this is the one writer. Later chunks extend it (pages in 4, templates in 18–20) rather
 * than fork it.
 */
/** How many changes a bot's draft keeps; the oldest are dropped past this. */
export const MAX_DRAFT_EVENTS = 200;

@Injectable()
export class BotDraftService {
  constructor(
    @InjectRepository(BotDraftEntity)
    private readonly drafts: Repository<BotDraftEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly events: BotDraftEventsService,
    @Optional() private readonly emitter?: EventEmitter2,
    // Stage 5 (D6): every new chatbot, blank ones included, gets its own quick-reply copies.
    @Optional() private readonly quickReplies?: QuickReplyCopyService,
  ) {}

  static defaultDraft(name: string): BotDraft {
    const clean = name.trim().slice(0, 120) || 'Your assistant';
    return {
      name: clean,
      assistantName: clean.slice(0, 60),
      introduction: '',
      instructions: '',
      tone: 'warm',
      languages: ['en'],
      topics: [],
      knowledgeDocumentIds: [],
      ownerNotes: '',
      suggestedQuestions: [],
      prechat: [],
      declineText: '',
      safetyPackId: SafetyPackId.STANDARD,
      extraNever: [],
      branding: {
        logoUrl: null,
        accentColour: DEFAULT_ACCENT_COLOUR,
        title: clean.slice(0, 80),
        subtitle: '',
        assistantName: clean.slice(0, 60),
        avatarUrl: null,
        disclaimer: '',
        footerLink: null,
      },
      access: { mode: 'invite', emails: [], organisationIds: [] },
      design: null,
      purpose: null,
      purposeNote: '',
    };
  }

  /**
   * A new draft, with the DRAFT chatbot its documents attach to. The owner is the person starting
   * it, and becomes the chatbot's OWNER (onboarding is open to AI Chatbots editors, not only
   * platform admins: Shehbaz, 2026-11-07).
   */
  async create(input: {
    name: string;
    website?: string | null;
    description?: string | null;
    interview?: boolean;
    /** Stage 3: created at the click with nothing chosen yet; untouched until the first action. */
    blank?: boolean;
  }): Promise<BotDraftEntity> {
    const userId = currentUserId();
    if (!userId) throw new ForbiddenException('Sign in first.');
    const tenantId = ExecutionManager.getTenantId() || null;
    const draftConfig = BotDraftService.defaultDraft(input.name);

    const created = await this.dataSource.transaction(async (manager) => {
      const chatbot = await manager.save(
        manager.create(Chatbot, {
          name: draftConfig.name,
          description: null,
          status: ChatbotStatus.DRAFT,
          persona: { displayName: draftConfig.assistantName },
          settings: {},
          createdBy: userId,
          updatedBy: userId,
        } as Partial<Chatbot>),
      );
      await manager.insert(ChatbotMember, {
        chatbotId: chatbot.id,
        userId,
        role: ChatbotMemberRole.OWNER,
        // Dual-write the role set (stage 1b) with the old single role.
        roles: [ChatbotMemberRole.OWNER],
        createdBy: userId,
      } as Partial<ChatbotMember>);
      return manager.save(
        manager.create(BotDraftEntity, {
          ownerUserId: userId,
          tenantId,
          status: BotDraftStatus.ACTIVE,
          step: input.website ? BotDraftStep.READING : BotDraftStep.LEARNED,
          source: {
            autoName: draftConfig.name,
            ...(input.website ? { website: input.website } : {}),
            ...(input.description ? { description: input.description } : {}),
            ...(input.interview ? { interview: true } : {}),
          },
          draftConfig,
          chatbotId: chatbot.id,
          transcript: [],
          events: [],
          version: 0,
          blank: Boolean(input.blank),
          touchedAt: input.blank ? null : new Date(),
          liveBase: {},
        }),
      );
    });
    // Outside the transaction: the globals still answer for it until the copy runs (the
    // mandatory ones always do), so a failed copy never fails the create.
    if (created.chatbotId) {
      await this.quickReplies
        ?.copyGlobalsInto(created.chatbotId)
        .catch(() => undefined);
    }
    return created;
  }

  /** The draft, if the caller started it; 404 otherwise (platform admins included). */
  async get(draftId: string): Promise<BotDraftEntity> {
    const draft = await this.drafts.findOne({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('That setup was not found.');
    if (draft.ownerUserId !== currentUserId()) {
      throw new NotFoundException('That setup was not found.');
    }
    return draft;
  }

  /** The caller's latest setup still in progress, for the resume banner. */
  current(): Promise<BotDraftEntity | null> {
    return this.drafts.findOne({
      where: { ownerUserId: currentUserId(), status: BotDraftStatus.ACTIVE },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Apply a change to the draft or to what was learned. Checked in order: the paths the actor may
   * touch, the patch itself, the result's shape, the safety pack, and the version the change was
   * made on. Logged with its inverse so it can be undone, and announced to the canvas.
   */
  async applyPatch(
    draft: BotDraftEntity,
    ops: PatchOp[],
    actor: BotDraftActor,
    options: {
      target: 'draft' | 'learned';
      expectedVersion?: number;
      summary?: string;
      /**
       * Stage 3: an edit to a chatbot's working copy, which lives for the chatbot's whole life. A
       * published setup's draft is still its working copy; only an abandoned one is closed.
       */
      workingCopy?: boolean;
    },
  ): Promise<{ draft: BotDraftEntity; event: DraftEvent }> {
    // Q4 N1: a placeholder ("unchanged") is never written as a name or a title.
    ops = ops.filter(
      (op) =>
        !(
          options.target === 'draft' &&
          NAME_PATHS.has(op.path) &&
          (op.op === 'replace' || op.op === 'add') &&
          isPlaceholder((op as { value?: unknown }).value)
        ),
    );
    const closed = options.workingCopy
      ? draft.status === BotDraftStatus.ABANDONED
      : draft.status !== BotDraftStatus.ACTIVE;
    if (closed && actor !== BotDraftActor.SYSTEM) {
      throw new ConflictException(
        'This setup is finished. Change the assistant from its own page.',
      );
    }
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== draft.version
    ) {
      throw new ConflictException({
        errorCode: 'stale_version',
        message:
          'Something changed while you were editing. Your view has been refreshed.',
      });
    }

    let patched: BotDraftEntity;
    let inverse: PatchOp[];
    try {
      if (options.target === 'draft') {
        const refused =
          actor === BotDraftActor.SYSTEM
            ? undefined
            : ops.find((op) => !pathAllowed(op.path, DRAFT_PATHS[actor]));
        if (refused) {
          throw new DraftPatchRefused(
            'path_not_allowed',
            `"${refused.path}" can't be changed here.`,
            {
              path: refused.path,
            },
          );
        }
        const applied = applyPatch(draft.draftConfig, ops);
        BotDraftService.validateDraft(applied.result);
        assertDraftKeepsPack(draft.draftConfig, applied.result);
        patched = { ...draft, draftConfig: applied.result };
        inverse = applied.inverse;
      } else {
        BotDraftService.checkLearnedOps(ops, actor);
        if (actor === BotDraftActor.OWNER) ops = markOwnerEdits(ops);
        const applied = applyPatch(draft.learned, ops);
        BotDraftService.validateLearned(applied.result, actor);
        patched = { ...draft, learned: applied.result };
        inverse = applied.inverse;
      }
    } catch (error) {
      if (error instanceof SafetyLockedError) {
        throw new DraftPatchRefused('safety_locked', error.message, {
          reason: error.reason,
        });
      }
      if (error instanceof PatchError) {
        throw new DraftPatchRefused('invalid_patch', error.message, {
          path: error.path,
        });
      }
      throw error;
    }

    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      kind: 'patch',
      target: options.target,
      ops,
      inverse,
      summary: options.summary ?? summarise(ops, options.target, draft.learned),
    };
    let saved = await this.save(patched, draft.version, [event]);
    // Q4 H4: made a staff assistant ("Train my team") after its pack was chosen from the
    // organisation's sector: the pack follows its readers, unless the owner chose it.
    if (
      options.target === 'draft' &&
      draft.draftConfig.purpose !== PurposeId.TRAINING &&
      saved.draftConfig.purpose === PurposeId.TRAINING &&
      sectorPackOnStaff(saved.draftConfig.safetyPackId) &&
      !saved.draftConfig.packChange
    ) {
      saved = await this.correctPack(saved, packForStaff(), STAFF_PACK_REASON);
    }
    await this.events.publish(draft.id, {
      type: 'patched',
      target: options.target,
      eventId: event.id,
      actor,
      summary: event.summary,
      version: saved.version,
      ...(options.target === 'draft'
        ? { draft: saved.draftConfig }
        : { learned: saved.learned }),
    });
    return { draft: saved, event };
  }

  /**
   * Undo one change by applying its inverse, unless a later change touched the same things (then
   * undoing it would silently throw that later change away).
   */
  async undo(draft: BotDraftEntity, eventId: string): Promise<BotDraftEntity> {
    const index = draft.events.findIndex((e) => e.id === eventId);
    const target = draft.events[index];
    if (
      !target ||
      target.kind !== 'patch' ||
      !target.inverse ||
      !target.target
    ) {
      throw new NotFoundException('That change was not found.');
    }
    if (target.undoneBy)
      throw new ConflictException('That change is already undone.');
    const touched = (target.ops ?? []).map((op) => op.path);
    const later = draft.events
      .slice(index + 1)
      .some(
        (e) =>
          e.kind === 'patch' &&
          !e.undoneBy &&
          e.target === target.target &&
          (e.ops ?? []).some((op) =>
            touched.some((p) => pathsOverlap(p, op.path)),
          ),
      );
    if (later) {
      throw new ConflictException(
        'A later change touched the same thing. Undo that one first.',
      );
    }
    const { draft: saved, event } = await this.applyPatch(
      draft,
      target.inverse,
      BotDraftActor.SYSTEM,
      { target: target.target, summary: `Undid "${target.summary}"` },
    );
    // Mark the original undone in the same row (a second write; the version moves again).
    const events = saved.events.map((e) =>
      e.id === target.id
        ? { ...e, undoneBy: event.id }
        : e.id === event.id
          ? { ...e, kind: 'undo' as const }
          : e,
    );
    return this.save({ ...saved, events }, saved.version, []);
  }

  /** One step back. Answers and edits are kept. */
  async back(draft: BotDraftEntity): Promise<BotDraftEntity> {
    const to = previousStep(draft.step);
    if (to === draft.step) return draft;
    return this.setStep(draft, to, BotDraftActor.OWNER);
  }

  /** Move to `to`, if the step machine allows it (the builder's `next_step` included). */
  async advance(
    draft: BotDraftEntity,
    to: BotDraftStep,
  ): Promise<BotDraftEntity> {
    if (!canAdvance(draft.step, to)) return draft;
    if (to === draft.step) return draft;
    return this.setStep(draft, to, BotDraftActor.BUILDER);
  }

  async setStep(
    draft: BotDraftEntity,
    step: BotDraftStep,
    actor: BotDraftActor,
  ): Promise<BotDraftEntity> {
    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      kind: 'step',
      summary: `${draft.step} → ${step}`,
    };
    const saved = await this.save({ ...draft, step }, draft.version, [event]);
    await this.events.publish(draft.id, {
      type: 'step',
      step,
      version: saved.version,
    });
    return saved;
  }

  /**
   * The owner corrects the pack in setup (Q4 A3, Round 6: "This isn't right for my business", and a
   * typed "we're a coworking space, not mental health" that left the pack as it was). Stricter at
   * once; less strict only with the owner's reason, recorded with the change, as on the home. The
   * pack's disclaimer follows, and the checkup's safety questions follow the pack when it is next
   * written.
   */
  async correctPack(
    draft: BotDraftEntity,
    packId: string,
    reason?: string | null,
  ): Promise<BotDraftEntity> {
    const next = packFor(packId);
    if (!next) {
      throw new BadRequestException({
        errorCode: 'invalid_pack',
        message: "That isn't one of the safety packs.",
      });
    }
    const was = packFor(draft.draftConfig.safetyPackId);
    if (was?.id === next.id) return draft;
    const lessStrict = Boolean(was && next.strength < was.strength);
    const why = (reason ?? '').trim();
    if (lessStrict && why.length < MIN_PACK_REASON) {
      throw new BadRequestException({
        errorCode: 'reason_required',
        message: `${next.name} is less strict than ${was!.name}. Say why it's right for your business.`,
      });
    }
    const branding = draft.draftConfig.branding;
    const without =
      was?.disclaimer && branding.disclaimer?.includes(was.disclaimer)
        ? branding.disclaimer.replace(was.disclaimer, '').trim()
        : (branding.disclaimer ?? '');
    const disclaimer = next.disclaimer
      ? [without, next.disclaimer].filter(Boolean).join(' ')
      : without;
    const packChange = {
      from: was?.id ?? null,
      to: next.id,
      reason: lessStrict ? why.slice(0, 300) : null,
      lessStrict,
      at: new Date().toISOString(),
      by: Number(ExecutionManager.getUserId() ?? 0) || null,
    };
    const event: DraftEvent = {
      id: randomUUID(),
      at: packChange.at,
      actor: BotDraftActor.OWNER,
      kind: 'safety',
      summary: `${next.name} is on (changed by you${lessStrict ? ', less strict' : ''})`,
    };
    const saved = await this.save(
      {
        ...draft,
        safetyPack: next.id,
        safetyPackVersion: next.version,
        draftConfig: {
          ...draft.draftConfig,
          safetyPackId: next.id,
          packChange,
          branding: { ...branding, disclaimer },
        },
      },
      draft.version,
      [event],
    );
    // The reason stays in the record; the log names only the move.
    LoggerService.getInstance(BotDraftService.name).warn(
      `Safety pack corrected by the owner in setup for draft ${draft.id}: ${packChange.from ?? 'none'} → ${next.id}${lessStrict ? ' (less strict, with a reason)' : ''}`,
    );
    await this.events.publish(draft.id, {
      type: 'safety',
      packId: next.id,
      industry: saved.industry,
      draft: saved.draftConfig,
      version: saved.version,
    });
    return saved;
  }

  /** Set the industry and its pack (server-side only), and put the pack's disclaimer on the page. */
  async setSafety(
    draft: BotDraftEntity,
    industry: BotDraftEntity['industry'],
    packId: SafetyPackId,
  ): Promise<BotDraftEntity> {
    const pack = packFor(packId)!;
    const was = packFor(draft.draftConfig.safetyPackId);
    // A pack is only ever raised: re-classifying can't weaken what is already on.
    const chosen =
      was && was.strength > pack.strength && draft.safetyPack ? was : pack;
    const disclaimer = chosen.disclaimer
      ? draft.draftConfig.branding.disclaimer?.includes(chosen.disclaimer)
        ? draft.draftConfig.branding.disclaimer
        : chosen.disclaimer
      : draft.draftConfig.branding.disclaimer;
    const draftConfig: BotDraft = {
      ...draft.draftConfig,
      safetyPackId: chosen.id,
      branding: { ...draft.draftConfig.branding, disclaimer },
    };
    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.SYSTEM,
      kind: 'safety',
      summary: `${chosen.name} is on`,
    };
    const saved = await this.save(
      {
        ...draft,
        industry,
        safetyPack: chosen.id,
        safetyPackVersion: chosen.version,
        draftConfig,
      },
      draft.version,
      [event],
    );
    await this.events.publish(draft.id, {
      type: 'safety',
      packId: chosen.id,
      industry,
      draft: saved.draftConfig,
      version: saved.version,
    });
    return saved;
  }

  /** Add lines to the builder chat. */
  async appendTranscript(
    draft: BotDraftEntity,
    entries: Omit<TranscriptEntry, 'id' | 'at'>[],
  ): Promise<BotDraftEntity> {
    const at = new Date().toISOString();
    const transcript = [
      ...draft.transcript,
      ...entries.map((entry) => ({ ...entry, id: randomUUID(), at })),
    ].slice(-400);
    return this.save({ ...draft, transcript }, draft.version, []);
  }

  /**
   * Add lines to the chat without a version bump (Copilot's change by chat, stage 3): a targeted
   * append, like `touch`, so a proposal's version stays good for Apply and a concurrent edit is
   * never refused because of a chat line. Keeps the newest 400 lines.
   */
  async appendTranscriptLines(
    draftId: string,
    entries: Omit<TranscriptEntry, 'id' | 'at'>[],
  ): Promise<void> {
    if (!entries.length) return;
    const at = new Date().toISOString();
    const lines = entries.map((entry) => ({ ...entry, id: randomUUID(), at }));
    await this.dataSource.query(
      `UPDATE bot_drafts SET transcript = (
         SELECT coalesce(jsonb_agg(t.e ORDER BY t.n), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(transcript, '[]'::jsonb) || $2::jsonb)
                WITH ORDINALITY AS t(e, n)
          WHERE t.n > jsonb_array_length(coalesce(transcript, '[]'::jsonb) || $2::jsonb) - 400)
        WHERE id = $1`,
      [draftId, JSON.stringify(lines)],
    );
  }

  /**
   * Save the crawl's progress. A targeted update that doesn't bump the version: the crawl runs in
   * the background while the owner may be editing, and its progress must never make their edit
   * stale (or be lost to it).
   */
  async saveCrawl(
    draftId: string,
    crawl: BotDraftEntity['crawl'],
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts SET crawl = $2::jsonb, "updatedAt" = now() WHERE id = $1`,
      [draftId, JSON.stringify(crawl)],
    );
  }

  /**
   * Stage 6: the facts of a paused crawl batch were read after a grant; the "paused: out of
   * credits" marker goes. Only on a crawl that has finished, so a running crawl's own save wins.
   */
  async clearCrawlPause(draftId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts SET crawl = crawl - 'pausedOutOfCredits' - 'pausedReason', "updatedAt" = now()
        WHERE id = $1 AND crawl ? 'pausedOutOfCredits' AND crawl->>'status' <> 'running'`,
      [draftId],
    );
  }

  /**
   * The resume sweep: a finished crawl still marked paused with no paused batch left for it (the
   * batch was resumed, or its job is gone) loses the marker. Idempotent; returns how many.
   */
  async clearStaleCrawlPauses(jobKind: string): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE bot_drafts d SET crawl = crawl - 'pausedOutOfCredits' - 'pausedReason', "updatedAt" = now()
        WHERE crawl ? 'pausedOutOfCredits' AND crawl->>'status' <> 'running'
          AND NOT EXISTS (SELECT 1 FROM credit_paused_jobs j
                           WHERE j.kind = $1 AND j.subject_id = d.id::text)
        RETURNING d.id`,
      [jobKind],
    );
    const rows =
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return Array.isArray(rows) ? rows.length : 0;
  }

  /**
   * The owner's page choice and removed pages, read fresh: the crawl checks them before each page,
   * so a choice made while it reads takes effect at once.
   */
  async pageChoice(
    draftId: string,
  ): Promise<{ include: string[]; exclude: string[]; removed: string[] }> {
    const [row] = (await this.dataSource.query(
      `SELECT source FROM bot_drafts WHERE id = $1`,
      [draftId],
    )) as { source: BotDraftEntity['source'] | null }[];
    return {
      include: row?.source?.pages?.include ?? [],
      exclude: row?.source?.pages?.exclude ?? [],
      removed: row?.source?.removed ?? [],
    };
  }

  /** Record a document the crawl or an upload added (server-maintained; patches can't touch it). */
  async addKnowledgeDocument(
    draftId: string,
    documentId: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts
          SET draft_config = jsonb_set(draft_config, '{knowledgeDocumentIds}',
                COALESCE(draft_config->'knowledgeDocumentIds', '[]'::jsonb) || to_jsonb($2::text)),
              "updatedAt" = now()
        WHERE id = $1 AND NOT (COALESCE(draft_config->'knowledgeDocumentIds', '[]'::jsonb) ? $2)`,
      [draftId, documentId],
    );
  }

  /**
   * Stage 3: a document added to a live chatbot, waiting for Apply (`source.pendingDocumentIds`).
   * Server-maintained, appended without a version bump like `addKnowledgeDocument`.
   */
  async addPendingDocument(draftId: string, documentId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts
          SET source = jsonb_set(source, '{pendingDocumentIds}',
                COALESCE(source->'pendingDocumentIds', '[]'::jsonb) || to_jsonb($2::text)),
              "updatedAt" = now()
        WHERE id = $1 AND NOT (COALESCE(source->'pendingDocumentIds', '[]'::jsonb) ? $2)`,
      [draftId, documentId],
    );
  }

  /** Stage 3: staged documents Apply attached, taken off the pending list. */
  async removePendingDocuments(
    draftId: string,
    documentIds: string[],
  ): Promise<void> {
    if (!documentIds.length) return;
    await this.dataSource.query(
      `UPDATE bot_drafts
          SET source = jsonb_set(source, '{pendingDocumentIds}',
                COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements_text(source->'pendingDocumentIds') v
                           WHERE v <> ALL($2::text[])), '[]'::jsonb)),
              "updatedAt" = now()
        WHERE id = $1`,
      [draftId, documentIds],
    );
  }

  /** Put a library document on the draft's chatbot (`chatbot_documents`), once. */
  async attachDocument(
    draft: Pick<BotDraftEntity, 'chatbotId' | 'ownerUserId'>,
    documentId: string,
  ): Promise<void> {
    if (!draft.chatbotId) return;
    await this.dataSource.query(
      `INSERT INTO chatbot_documents (chatbot_id, document_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [draft.chatbotId, documentId, draft.ownerUserId],
    );
  }

  /**
   * Put the site's logo and colour on the draft's page branding, unless the owner already set them.
   * A versioned write (it touches what the owner can edit), retried on a stale version.
   */
  async applyBrand(
    draftId: string,
    brand: { logoUrl: string | null; accentColour: string | null },
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const draft = await this.drafts.findOne({ where: { id: draftId } });
      if (!draft) return;
      const branding = { ...draft.draftConfig.branding };
      // The page only takes an https logo (BotPageBrandingDto); an http one would make every
      // later change to the draft fail validation.
      if (brand.logoUrl?.startsWith('https://') && !branding.logoUrl) {
        branding.logoUrl = brand.logoUrl;
      }
      if (
        brand.accentColour &&
        branding.accentColour === DEFAULT_ACCENT_COLOUR
      ) {
        branding.accentColour = brand.accentColour;
      }
      if (
        branding.logoUrl === draft.draftConfig.branding.logoUrl &&
        branding.accentColour === draft.draftConfig.branding.accentColour
      ) {
        return;
      }
      try {
        const saved = await this.save(
          { ...draft, draftConfig: { ...draft.draftConfig, branding } },
          draft.version,
          [],
        );
        await this.events.publish(draftId, {
          type: 'draft',
          draft: saved.draftConfig,
          version: saved.version,
        });
        return;
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
  }

  /** Drafts whose crawl was left running (an instance restarted mid-crawl), for the sweep. */
  findStalledCrawls(olderThanSeconds: number): Promise<BotDraftEntity[]> {
    return (
      this.drafts
        .createQueryBuilder('d')
        // Stage 3: a live chatbot's working copy (published) reads new sources too.
        .where(`d.status <> :abandoned`, {
          abandoned: BotDraftStatus.ABANDONED,
        })
        .andWhere(`d.crawl->>'status' = 'running'`)
        .andWhere(
          `d."updatedAt" < now() - (:seconds || ' seconds')::interval`,
          {
            seconds: String(olderThanSeconds),
          },
        )
        .take(20)
        .getMany()
    );
  }

  async findById(draftId: string): Promise<BotDraftEntity | null> {
    return this.drafts.findOne({ where: { id: draftId } });
  }

  /** The draft that built a chatbot, if one did. */
  findByChatbot(chatbotId: string): Promise<BotDraftEntity | null> {
    return this.drafts.findOne({ where: { chatbotId } });
  }

  // ── Stage 3: the working copy ─────────────────────────────────────────

  /**
   * The chatbot's working copy (one draft per chatbot, `uq_bot_drafts_chatbot`). A setup left
   * abandoned comes back as the working copy: the chatbot is being built again.
   */
  async findWorkingCopy(chatbotId: string): Promise<BotDraftEntity | null> {
    const draft = await this.drafts.findOne({ where: { chatbotId } });
    if (!draft || draft.status !== BotDraftStatus.ABANDONED) return draft;
    const [chatbot] = (await this.dataSource.query(
      `SELECT status FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { status: ChatbotStatus }[];
    const live = Boolean(chatbot) && chatbot.status !== ChatbotStatus.DRAFT;
    return this.update(draft, {
      status: live ? BotDraftStatus.PUBLISHED : BotDraftStatus.ACTIVE,
      // Nothing agreed with live yet: the merge adopts the live values first.
      liveBase: {},
    });
  }

  /**
   * The first meaningful action on a chatbot (template, path, source, edit, test message). Never
   * moves back: once touched, a blank is never swept. No version bump, so it races nothing.
   */
  async touch(draftId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts SET touched_at = now() WHERE id = $1 AND touched_at IS NULL`,
      [draftId],
    );
  }

  /** The chatbot went live: from now on its working copy waits for Apply. Set once. */
  async markLive(draftId: string, base: Record<string, string>): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts
          SET live_at = COALESCE(live_at, now()),
              live_base = $2::jsonb,
              touched_at = COALESCE(touched_at, now())
        WHERE id = $1`,
      [draftId, JSON.stringify(base)],
    );
  }

  /** The builder's last mode on this chatbot (Copilot or the form). */
  async setBuildMode(draftId: string, mode: 'copilot' | 'form'): Promise<void> {
    await this.dataSource.query(
      `UPDATE bot_drafts SET build_mode = $2 WHERE id = $1`,
      [draftId, mode],
    );
  }

  /**
   * A working copy for a chatbot that has none (made by hand, or its only draft was abandoned): the
   * live chatbot as it is, owned by its creator, already in step with live.
   */
  async createWorkingCopy(
    chatbot: Chatbot,
    config: BotDraft,
    base: Record<string, string>,
  ): Promise<BotDraftEntity> {
    const live = chatbot.status !== ChatbotStatus.DRAFT;
    const saved = await this.drafts.save(
      this.drafts.create({
        ownerUserId: chatbot.createdBy,
        tenantId: ExecutionManager.getTenantId() || null,
        status: live ? BotDraftStatus.PUBLISHED : BotDraftStatus.ACTIVE,
        step: live ? BotDraftStep.PUBLISHED : BotDraftStep.LEARNED,
        source: { autoName: null },
        draftConfig: config,
        chatbotId: chatbot.id,
        transcript: [],
        events: [],
        version: 0,
        blank: false,
        touchedAt: new Date(),
        liveAt: live ? new Date() : null,
        liveBase: base,
      }),
    );
    return saved;
  }

  /** Persist a draft that changed in ways other than a patch (crawl, answers, design). */
  update(
    draft: BotDraftEntity,
    patch: Partial<BotDraftEntity>,
    events: DraftEvent[] = [],
  ): Promise<BotDraftEntity> {
    return this.save({ ...draft, ...patch }, draft.version, events);
  }

  /**
   * Write with an optimistic check: the row must still be at the version this change was based
   * on. Two writers racing (the crawl and an edit) never silently overwrite each other.
   */
  private async save(
    draft: BotDraftEntity,
    basedOn: number,
    newEvents: DraftEvent[],
  ): Promise<BotDraftEntity> {
    const next = {
      ...draft,
      // The newest MAX_DRAFT_EVENTS only (chunk 20d-2): every hand edit now adds one.
      events: [...draft.events, ...newEvents].slice(-MAX_DRAFT_EVENTS),
      version: basedOn + 1,
    };
    // TF1 N3: the name it uses in chat follows the assistant's name while it is still the default
    // ("Your assistant" on the card and in chat after the owner had named it). An owner's own chat
    // name is never touched.
    const named = String(next.draftConfig?.name ?? '').trim();
    if (
      next.draftConfig &&
      /^your assistant$/i.test(
        String(next.draftConfig.assistantName ?? '').trim(),
      ) &&
      named &&
      realName(named, '') === named &&
      !/^your assistant$/i.test(named)
    ) {
      next.draftConfig = {
        ...next.draftConfig,
        assistantName: named.slice(0, 60),
      };
    }
    const result = await this.drafts
      .createQueryBuilder()
      .update(BotDraftEntity)
      // jsonb columns are typed loosely here: TypeORM's deep-partial type can't express `unknown`.
      .set({
        status: next.status,
        step: next.step,
        // Stage 3: staged documents are kept from the row, like the documents list below: the
        // crawl appends to them without a version bump (`addPendingDocument`), and Apply removes
        // them with `removePendingDocuments`.
        source: () =>
          `jsonb_set(CAST(:source AS jsonb), '{pendingDocumentIds}', COALESCE(source->'pendingDocumentIds', CAST(:pendingIds AS jsonb)))`,
        // Never `crawl`: only the crawl writes it (`saveCrawl`), so a draft read before the
        // crawl's latest page can't roll its progress back.
        learned: next.learned,
        industry: next.industry ?? null,
        safetyPack: next.safetyPack ?? null,
        safetyPackVersion: next.safetyPackVersion ?? null,
        answers: next.answers,
        design: next.design,
        // The documents list is kept from the row: the crawl and uploads add to it without a
        // version bump (`addKnowledgeDocument`), and a draft read earlier must not drop them.
        draftConfig: () =>
          `jsonb_set(CAST(:draftConfig AS jsonb), '{knowledgeDocumentIds}', COALESCE(draft_config->'knowledgeDocumentIds', CAST(:documentIds AS jsonb)))`,
        chatbotId: next.chatbotId ?? null,
        transcript: next.transcript,
        events: next.events,
        version: next.version,
        // Stage 3: the per-field merge base moves with the working copy it describes.
        ...(next.liveBase ? { liveBase: next.liveBase } : {}),
      } as never)
      .where('id = :id AND version = :basedOn', { id: draft.id, basedOn })
      .setParameter('draftConfig', JSON.stringify(next.draftConfig))
      .setParameter('source', JSON.stringify(next.source ?? {}))
      .setParameter(
        'pendingIds',
        JSON.stringify(next.source?.pendingDocumentIds ?? []),
      )
      .setParameter(
        'documentIds',
        JSON.stringify(next.draftConfig.knowledgeDocumentIds ?? []),
      )
      .execute();
    if (!result.affected) {
      throw new ConflictException({
        errorCode: 'stale_version',
        message:
          'Something changed while you were editing. Your view has been refreshed.',
      });
    }
    // TF1 F12: before go-live the name typed in setup is the assistant's name everywhere (Try it,
    // the checkup, the list card): the not-yet-live chatbot row takes it. Never a placeholder, and
    // never on a live chatbot (its name changes on Apply).
    const typedName = String(next.draftConfig?.name ?? '').trim();
    if (
      next.chatbotId &&
      typedName &&
      realName(typedName, '') === typedName &&
      !/^your assistant$/i.test(typedName)
    ) {
      await this.drafts.manager
        ?.query(
          `UPDATE chatbots SET name = $2,
                  persona = CASE WHEN COALESCE(persona->>'displayName', '') ~* '^(your assistant)?$'
                                 THEN jsonb_set(COALESCE(persona, '{}'::jsonb), '{displayName}', to_jsonb(left($2, 60)))
                                 ELSE persona END
            WHERE id = $1 AND status = 'draft'`,
          [next.chatbotId, typedName.slice(0, 120)],
        )
        .catch(() => undefined);
    }
    // Q3-fast Part 2: once the facts are a document, it follows every save (an unchanged text is
    // a no-op there), so a removed page, a correction or a re-read reaches what the assistant knows.
    // Stage 3: on a live chatbot, facts read from a source added after go-live wait for Apply
    // (`source.factsStaged`), like the source itself.
    if (
      next.chatbotId &&
      next.source?.learnedFactsDocumentId &&
      !next.source?.factsStaged
    ) {
      this.emitter?.emit(LEARNED_FACTS_CHANGED, {
        chatbotId: next.chatbotId,
        documentId: next.source.learnedFactsDocumentId,
        facts: (next.learned?.facts ?? []) as LearnedFact[],
        ownerUserId: next.ownerUserId,
        tenantId: next.tenantId ?? null,
      } satisfies LearnedFactsChanged);
    }
    return next;
  }

  // ── validation ────────────────────────────────────────────────────────

  static validateDraft(draft: BotDraft): void {
    const errors = validateSync(plainToInstance(BotDraftDto, draft), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      const first = errors[0];
      const nested = first.children?.[0];
      throw new DraftPatchRefused(
        'invalid_draft',
        Object.values(first.constraints ?? nested?.constraints ?? {})[0] ??
          `"${first.property}" isn't valid.`,
        { property: first.property },
      );
    }
  }

  /** Owners edit, add (sourced as "From you") and remove facts; the builder only adds. */
  private static checkLearnedOps(ops: PatchOp[], actor: BotDraftActor): void {
    for (const op of ops) {
      const ok =
        actor === BotDraftActor.SYSTEM ||
        (op.op === 'add' && op.path === '/facts/-') ||
        (actor === BotDraftActor.OWNER &&
          (/^\/facts\/\d+$/.test(op.path) ||
            /^\/facts\/\d+\/text$/.test(op.path)));
      if (!ok) {
        throw new DraftPatchRefused(
          'path_not_allowed',
          `"${op.path}" can't be changed here.`,
          {
            path: op.path,
          },
        );
      }
    }
  }

  /** Every fact needs a section, some text and a source; the builder's must be a page we read. */
  private static validateLearned(learned: Learned, actor: BotDraftActor): void {
    for (const fact of learned.facts as LearnedFact[]) {
      if (
        !fact ||
        typeof fact.id !== 'string' ||
        !SECTIONS.has(fact.section) ||
        typeof fact.text !== 'string' ||
        !fact.text.trim() ||
        fact.text.length > FACT_MAX_CHARS ||
        typeof fact.sourceUrl !== 'string' ||
        !fact.sourceUrl
      ) {
        throw new DraftPatchRefused(
          'invalid_fact',
          'Each detail needs a section, some text and where it came from.',
        );
      }
      if (
        fact.sourceUrl === OWNER_SOURCE &&
        !fact.byOwner &&
        actor === BotDraftActor.BUILDER
      ) {
        throw new DraftPatchRefused(
          'invalid_fact',
          'Only you can add details from yourself.',
        );
      }
    }
  }
}

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * A fact the owner rewrote is theirs now: its source shows "From you", not the page it was read
 * from (chunk 20d). Marked in the same change, so Undo puts the source back with the text.
 */
function markOwnerEdits(ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op) => {
    if (op.op === 'replace' && /^\/facts\/\d+\/text$/.test(op.path)) {
      return [
        op,
        {
          op: 'add',
          path: op.path.replace(/\/text$/, '/byOwner'),
          value: true,
        },
      ];
    }
    if (op.op === 'replace' && /^\/facts\/\d+$/.test(op.path)) {
      return [
        { ...op, value: { ...(op.value as LearnedFact), byOwner: true } },
      ];
    }
    return [op];
  });
}

/** What an owner's edit changed, as the chat says it (copy §15: "Updated your hours"). */
const FIELD_LABELS: Record<string, string> = {
  name: "your assistant's name",
  assistantName: "your assistant's name",
  introduction: 'its introduction',
  instructions: 'its instructions',
  tone: 'its tone',
  languages: 'its languages',
  topics: 'its topics',
  suggestedQuestions: 'its suggested questions',
  prechat: 'its questions before the chat',
  declineText: "what it says when it doesn't know",
  extraNever: 'your own rules',
  branding: 'your page',
  access: 'who can use it',
  ownerNotes: 'your notes',
  design: 'its design',
  purpose: "what it's for",
  purposeNote: "what it's for",
};
const SECTION_LABELS: Record<string, string> = {
  about: 'what we learned about you',
  services: 'your services and prices',
  hours: 'your hours',
  team: 'your team',
  location: 'your address and contact details',
  policies: 'your policies',
  faqs: 'your common questions',
  brand: 'your brand',
};

export function summarise(
  ops: PatchOp[],
  target: 'draft' | 'learned',
  learned?: Learned,
): string {
  const labels =
    target === 'learned'
      ? ops.map((op) => {
          const index = Number(op.path.split('/')[2]);
          const fact = Number.isInteger(index)
            ? learned?.facts[index]
            : (op.value as LearnedFact | undefined);
          return SECTION_LABELS[fact?.section ?? ''] ?? SECTION_LABELS.about;
        })
      : ops.map(
          (op) => FIELD_LABELS[op.path.split('/')[1]] ?? 'your assistant',
        );
  const unique = [...new Set(labels)];
  return `Updated ${unique.slice(0, 2).join(' and ')}`;
}
