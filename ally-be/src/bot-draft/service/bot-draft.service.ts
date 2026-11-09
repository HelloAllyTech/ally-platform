import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  SafetyPackId,
} from '../enum/bot-draft.enum';
import {
  assertDraftKeepsPack,
  SafetyLockedError,
} from '../safety-pack/safety-lock';
import { packFor } from '../safety-pack/safety-packs';
import type {
  BotDraft,
  DraftEvent,
  Learned,
  LearnedFact,
  PatchOp,
  TranscriptEntry,
} from '../type/bot-draft.type';
import { BotDraftEventsService } from './bot-draft-events.service';
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
export const DRAFT_PATHS: Record<BotDraftActor, readonly string[]> = {
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
@Injectable()
export class BotDraftService {
  constructor(
    @InjectRepository(BotDraftEntity)
    private readonly drafts: Repository<BotDraftEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly events: BotDraftEventsService,
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
  }): Promise<BotDraftEntity> {
    const userId = currentUserId();
    if (!userId) throw new ForbiddenException('Sign in first.');
    const tenantId = ExecutionManager.getTenantId() || null;
    const draftConfig = BotDraftService.defaultDraft(input.name);

    return this.dataSource.transaction(async (manager) => {
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
          },
          draftConfig,
          chatbotId: chatbot.id,
          transcript: [],
          events: [],
          version: 0,
        }),
      );
    });
  }

  /** The draft, if the caller owns it (or is a platform admin); 404 otherwise. */
  async get(draftId: string): Promise<BotDraftEntity> {
    const draft = await this.drafts.findOne({ where: { id: draftId } });
    if (!draft) throw new NotFoundException('That setup was not found.');
    if (
      draft.ownerUserId !== currentUserId() &&
      !(await this.access.isPlatformAdmin())
    ) {
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
    },
  ): Promise<{ draft: BotDraftEntity; event: DraftEvent }> {
    if (
      draft.status !== BotDraftStatus.ACTIVE &&
      actor !== BotDraftActor.SYSTEM
    ) {
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
    const saved = await this.save(patched, draft.version, [event]);
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
    return this.drafts
      .createQueryBuilder('d')
      .where(`d.status = :active`, { active: BotDraftStatus.ACTIVE })
      .andWhere(`d.crawl->>'status' = 'running'`)
      .andWhere(`d."updatedAt" < now() - (:seconds || ' seconds')::interval`, {
        seconds: String(olderThanSeconds),
      })
      .take(20)
      .getMany();
  }

  async findById(draftId: string): Promise<BotDraftEntity | null> {
    return this.drafts.findOne({ where: { id: draftId } });
  }

  /** The draft that built a chatbot, if one did. */
  findByChatbot(chatbotId: string): Promise<BotDraftEntity | null> {
    return this.drafts.findOne({ where: { chatbotId } });
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
      events: [...draft.events, ...newEvents],
      version: basedOn + 1,
    };
    const result = await this.drafts
      .createQueryBuilder()
      .update(BotDraftEntity)
      // jsonb columns are typed loosely here: TypeORM's deep-partial type can't express `unknown`.
      .set({
        status: next.status,
        step: next.step,
        source: next.source,
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
      } as never)
      .where('id = :id AND version = :basedOn', { id: draft.id, basedOn })
      .setParameter('draftConfig', JSON.stringify(next.draftConfig))
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
