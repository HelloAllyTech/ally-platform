import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotDocument } from '../../chatbot/entity/chatbot-document.entity';
import {
  ChatbotMemberRole,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import type { ChatbotTestOverride } from '../../chatbot/service/chatbot.service';
import { KbDocumentSourceType } from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor, BotDraftStatus } from '../enum/bot-draft.enum';
import { AssistantHomeService } from '../home/assistant-home.service';
import { homeField, HomeFieldInvalid } from '../home/home-fields';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import {
  BotDraftPublishService,
  enabledLanguagesPatch,
  OWNER_NOTES_TITLE,
  pageLanguage,
} from '../service/bot-draft-publish.service';
import {
  BotDraftService,
  DraftPatchRefused,
} from '../service/bot-draft.service';
import type { BotDraft } from '../type/bot-draft.type';
import {
  CREDITS_GATE,
  CREDITS_REQUIRED,
  type CreditsGate,
} from './credits-gate';
import {
  SAFETY_APPLY_CHECK,
  type SafetyApplyCheck,
} from './safety-apply-check';
import {
  EDITABLE_FIELDS,
  fieldVersion,
  isEditableField,
  mergeWithLive,
  SAFETY_RELEVANT,
  settingsHash,
  SOURCES_FIELD,
  STAGED_FIELDS,
  workingValues,
  type PendingChange,
  type StagedField,
} from './staged-fields';

/** How often a field edit retries when another field's edit moved the draft first. */
const EDIT_RETRIES = 3;

/** Fields written through the assistant home's field saves (same parsing and page writes). */
const HOME_WRITES: Partial<Record<StagedField, string>> = {
  name: 'name',
  assistantName: 'assistantName',
  introduction: 'introduction',
  tone: 'tone',
  instructions: 'instructions',
  declineText: 'declineText',
  suggestedQuestions: 'suggestedQuestions',
};

export interface WorkingCopyContext {
  draft: BotDraftEntity;
  chatbot: Chatbot;
  /** The chatbot has gone live: the working copy waits for Apply (R3). */
  live: boolean;
}

/**
 * Stage 3, the working copy (plan section 3 "Config model"). Every chatbot has a working copy (its
 * `bot_drafts` row, for the chatbot's whole life) and a live configuration (the chatbot row, its
 * page and documents).
 *
 * - Before the chatbot has ever gone live, edits are projected onto the row as they always were
 *   (`BotDraftPublishService.stage`, on every test).
 * - Once live, the test pane runs the working copy as a server-side override (`testOverride`) and
 *   nothing is written to the live chatbot until Apply, which validates the pending diff, runs the
 *   safety check (failing closed) on safety-relevant fields only, and writes them.
 *
 * Each working-copy field has its own version (a hash of its value), so two tabs editing different
 * fields never conflict, and a refused or conflicting edit returns the current value for the client
 * to show beside what was typed.
 */
@Injectable()
export class WorkingCopyService {
  private readonly logger = LoggerService.getInstance(WorkingCopyService.name);

  constructor(
    private readonly drafts: BotDraftService,
    private readonly access: ChatbotAccessService,
    private readonly pages: BotPageService,
    private readonly knowledge: KnowledgeBaseService,
    private readonly home: AssistantHomeService,
    private readonly publisher: BotDraftPublishService,
    @InjectRepository(Chatbot)
    private readonly chatbots: Repository<Chatbot>,
    @InjectRepository(ChatbotDocument)
    private readonly chatbotDocuments: Repository<ChatbotDocument>,
    @Inject(SAFETY_APPLY_CHECK) private readonly safety: SafetyApplyCheck,
    @Optional() @Inject(CREDITS_GATE) private readonly credits?: CreditsGate,
  ) {}

  // ── loading ────────────────────────────────────────────────────────────

  static isLive(draft: BotDraftEntity, chatbot: Pick<Chatbot, 'status'>) {
    return (
      Boolean(draft.liveAt) ||
      draft.status === BotDraftStatus.PUBLISHED ||
      chatbot.status !== ChatbotStatus.DRAFT
    );
  }

  /** A draft (by its id) as a working copy the caller may edit. 404 for someone else's. */
  async forDraft(
    draftId: string,
    role = ChatbotMemberRole.EDITOR,
  ): Promise<WorkingCopyContext> {
    const draft = await this.drafts.findById(draftId);
    if (!draft?.chatbotId || draft.status === BotDraftStatus.ABANDONED) {
      throw new NotFoundException('That assistant was not found.');
    }
    const { chatbot } = await this.access.assert(draft.chatbotId, role);
    return { draft, chatbot, live: WorkingCopyService.isLive(draft, chatbot) };
  }

  /** A chatbot's working copy, created from the live chatbot when it has none yet. */
  async forChatbot(
    chatbotId: string,
    role = ChatbotMemberRole.EDITOR,
  ): Promise<WorkingCopyContext> {
    const { chatbot } = await this.access.assert(chatbotId, role);
    let draft = await this.drafts.findWorkingCopy(chatbotId);
    if (!draft) {
      const live = await this.liveValues(chatbot, null);
      draft = await this.drafts.createWorkingCopy(
        chatbot,
        configFromLive(chatbot, live),
        baseOf(live),
      );
    }
    return { draft, chatbot, live: WorkingCopyService.isLive(draft, chatbot) };
  }

  // ── reading ────────────────────────────────────────────────────────────

  /**
   * The live chatbot's staged fields, as the working copy holds them. `draft` gives the Owner notes
   * document; null for a chatbot with no working copy yet.
   */
  async liveValues(
    chatbot: Chatbot,
    draft: Pick<BotDraftEntity, 'source'> | null,
  ): Promise<Record<StagedField, unknown>> {
    const view = await this.pages.view(chatbot);
    const persona = (chatbot.persona ?? {}) as Chatbot['persona'] & {
      languages?: string[];
    };
    return {
      name: (chatbot.name ?? '').trim(),
      assistantName: (persona.displayName ?? '').trim(),
      introduction: (persona.greeting ?? '').trim(),
      tone: (persona.tone ?? '').trim(),
      instructions: (persona.systemPrompt ?? '').trim(),
      languages: persona.languages?.length
        ? [...persona.languages]
        : [persona.defaultLanguage || 'en'],
      suggestedQuestions: [...(view.settings.suggestedQuestions ?? [])],
      declineText: String(chatbot.settings?.declineText ?? '').trim(),
      extraNever: [...(chatbot.rules?.never ?? [])],
      ownerNotes: (await this.liveNotes(draft)).trim(),
    };
  }

  private async liveNotes(
    draft: Pick<BotDraftEntity, 'source'> | null,
  ): Promise<string> {
    const id = draft?.source?.ownerNotesDocumentId;
    if (!id) return '';
    try {
      const document = await this.knowledge.getForChatbot(id);
      return document.isArchived ? '' : (document.rawText ?? '');
    } catch {
      return '';
    }
  }

  /**
   * Brings the working copy in step with the live chatbot (the three-way merge): a field nobody
   * edited in the working copy follows the live value, so an edit made on the live chatbot
   * elsewhere is never reported as a change that Apply would undo. Persisted when anything moved.
   */
  async sync(ctx: WorkingCopyContext): Promise<{
    draft: BotDraftEntity;
    live: Record<StagedField, unknown>;
    pending: StagedField[];
    conflicted: StagedField[];
  }> {
    const live = await this.liveValues(ctx.chatbot, ctx.draft);
    let draft = ctx.draft;
    for (let attempt = 0; ; attempt++) {
      const merged = mergeWithLive(
        workingValues(draft.draftConfig),
        live,
        draft.liveBase ?? {},
      );
      const moved =
        Object.keys(merged.adopt).length > 0 ||
        JSON.stringify(merged.base) !== JSON.stringify(draft.liveBase ?? {});
      if (!moved) {
        return {
          draft,
          live,
          pending: merged.pending,
          conflicted: merged.conflicted,
        };
      }
      try {
        draft = await this.drafts.update(draft, {
          draftConfig: { ...draft.draftConfig, ...merged.adopt } as BotDraft,
          liveBase: merged.base,
        });
        return {
          draft,
          live,
          pending: merged.pending,
          conflicted: merged.conflicted,
        };
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt >= EDIT_RETRIES) {
          throw error;
        }
        draft = (await this.drafts.findById(draft.id)) ?? draft;
      }
    }
  }

  /** `GET .../pending`: what Apply would publish, field by field. */
  async pending(ctx: WorkingCopyContext) {
    if (!ctx.live) {
      return {
        live: false,
        changes: [] as PendingChange[],
        settingsHash: settingsHash(ctx.draft.draftConfig),
        liveVersion: null,
      };
    }
    const synced = await this.sync(ctx);
    const changes = await this.diff(synced.draft, synced.live, synced);
    return {
      live: true,
      changes,
      settingsHash: settingsHash(
        synced.draft.draftConfig,
        synced.draft.source?.pendingDocumentIds ?? [],
      ),
      liveVersion: fieldVersion(synced.live),
    };
  }

  private async diff(
    draft: BotDraftEntity,
    live: Record<StagedField, unknown>,
    merged: { pending: StagedField[]; conflicted: StagedField[] },
  ): Promise<PendingChange[]> {
    const working = workingValues(draft.draftConfig);
    const changes: PendingChange[] = merged.pending.map((field) => ({
      field,
      live: live[field],
      working: working[field],
      liveVersion: fieldVersion(live[field]),
      workingVersion: fieldVersion(working[field]),
      safetyRelevant: SAFETY_RELEVANT.has(field),
      liveChangedElsewhere: merged.conflicted.includes(field),
    }));
    const staged = draft.source?.pendingDocumentIds ?? [];
    if (staged.length) {
      const rows: { id: string; title: string; status: string }[] =
        await this.chatbotDocuments.manager.query(
          `SELECT id, title, status FROM kb_documents
            WHERE id = ANY($1) AND archived_at IS NULL ORDER BY "createdAt"`,
          [staged],
        );
      changes.push({
        field: SOURCES_FIELD,
        live: null,
        working: rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
        })),
        liveVersion: fieldVersion(null),
        workingVersion: fieldVersion(rows.map((r) => r.id)),
        safetyRelevant: true,
        liveChangedElsewhere: false,
      });
    }
    return changes;
  }

  // ── editing one field ──────────────────────────────────────────────────

  /**
   * One working-copy field, refused when `version` (the hash of the value the edit started from) is
   * stale. Different fields never conflict: a draft moved by another field's edit is re-read and the
   * edit retried. A refusal or a conflict returns the current value and version in `details`, so the
   * client keeps the typed text beside it ("not applied", Reload, Overwrite).
   */
  async editField(
    ctx: WorkingCopyContext,
    field: string,
    value: unknown,
    version: string,
    actor: BotDraftActor = BotDraftActor.OWNER,
  ) {
    if (!isEditableField(field)) {
      throw new BadRequestException({
        errorCode: 'unknown_field',
        message: `"${field}" can't be changed here.`,
        details: { field, editable: EDITABLE_FIELDS },
      });
    }
    let draft = ctx.draft;
    if (ctx.live) draft = (await this.sync(ctx)).draft;
    for (let attempt = 0; ; attempt++) {
      const current = draft.draftConfig[field as keyof BotDraft];
      const currentVersion = fieldVersion(current);
      if (currentVersion !== version) {
        throw new ConflictException({
          errorCode: 'stale_field',
          message:
            'This changed while you were editing. Here is what it says now.',
          details: { field, value: current ?? null, version: currentVersion },
        });
      }
      if (currentVersion === fieldVersion(value)) {
        return this.fieldResult(draft, field, ctx.live);
      }
      try {
        const { draft: saved } = await this.drafts.applyPatch(
          draft,
          [{ op: 'replace', path: `/${field}`, value }],
          actor,
          { target: 'draft', workingCopy: true },
        );
        await this.drafts.touch(saved.id);
        return this.fieldResult(saved, field, ctx.live);
      } catch (error) {
        if (error instanceof DraftPatchRefused) {
          const body = error.getResponse() as Record<string, unknown>;
          throw new BadRequestException({
            ...body,
            details: {
              ...((body.details as object) ?? {}),
              field,
              value: current ?? null,
              version: currentVersion,
            },
          });
        }
        const stale =
          error instanceof ConflictException &&
          (error.getResponse() as { errorCode?: string })?.errorCode ===
            'stale_version';
        if (!stale || attempt >= EDIT_RETRIES) throw error;
        draft = (await this.drafts.findById(draft.id)) ?? draft;
      }
    }
  }

  private fieldResult(draft: BotDraftEntity, field: string, live: boolean) {
    const value = draft.draftConfig[field as keyof BotDraft] ?? null;
    return {
      field,
      value,
      version: fieldVersion(value),
      settingsHash: settingsHash(
        draft.draftConfig,
        draft.source?.pendingDocumentIds ?? [],
      ),
      /** True when this reaches customers only on Apply. */
      staged: live && (STAGED_FIELDS as readonly string[]).includes(field),
    };
  }

  /** Every editable field's value and version, for the form's first load. */
  fields(draft: BotDraftEntity) {
    const out: Record<string, { value: unknown; version: string }> = {};
    for (const field of EDITABLE_FIELDS) {
      const value = draft.draftConfig[field as keyof BotDraft] ?? null;
      out[field] = { value, version: fieldVersion(value) };
    }
    return out;
  }

  // ── testing ────────────────────────────────────────────────────────────

  /**
   * The server-side override a live chatbot's test runs with: the working copy's staged fields and
   * the documents it would answer from after Apply. Built here only; nothing comes from the client.
   * `waitFor` names documents whose fresh text should be searchable before the reply.
   */
  async testOverride(ctx: WorkingCopyContext): Promise<{
    override: ChatbotTestOverride;
    waitFor: string[];
    draft: BotDraftEntity;
  }> {
    const synced = await this.sync(ctx);
    let draft = synced.draft;
    const working = workingValues(draft.draftConfig);
    const attached = (
      await this.chatbotDocuments.find({
        where: { chatbotId: ctx.chatbot.id },
        select: ['documentId'],
      })
    ).map((row) => row.documentId);
    const liveNotesId = draft.source?.ownerNotesDocumentId ?? null;
    const waitFor: string[] = [];
    let notesId: string | null = liveNotesId;
    if (synced.pending.includes('ownerNotes')) {
      notesId = await this.workingNotes(ctx, draft, String(working.ownerNotes));
      draft = (await this.drafts.findById(draft.id)) ?? draft;
      if (notesId) waitFor.push(notesId);
    }
    const documentIds = [
      ...new Set([
        ...attached.filter((id) => id !== liveNotesId),
        ...(notesId ? [notesId] : []),
        ...(draft.source?.pendingDocumentIds ?? []),
      ]),
    ];
    const languages = working.languages as string[];
    const declineText = String(working.declineText ?? '');
    const settings = { ...(ctx.chatbot.settings ?? {}) } as Record<
      string,
      unknown
    >;
    if (declineText) settings.declineText = declineText;
    else delete settings.declineText;
    return {
      draft,
      waitFor,
      override: {
        readOnly: true,
        name: String(working.name),
        persona: {
          displayName: String(working.assistantName),
          greeting: String(working.introduction),
          tone: String(working.tone),
          systemPrompt: String(working.instructions),
          defaultLanguage: languages[0] ?? 'en',
        },
        settings: settings as Chatbot['settings'],
        rules: {
          ...(ctx.chatbot.rules ?? { never: [] }),
          never: working.extraNever as string[],
        },
        documentIds,
      },
    };
  }

  /**
   * The working copy's own notes document on a live chatbot: owned by the chatbot, never on it, so
   * only a working-copy test reads it. Created once, then updated (unchanged text is a no-op).
   */
  private async workingNotes(
    ctx: WorkingCopyContext,
    draft: BotDraftEntity,
    text: string,
  ): Promise<string | null> {
    if (!text.trim()) return null;
    const existing = draft.source?.workingNotesDocumentId ?? null;
    try {
      if (existing) {
        await this.knowledge.updateForChatbot(ctx.chatbot.id, existing, {
          text,
        });
        return existing;
      }
      const document = await this.knowledge.createForChatbot(ctx.chatbot.id, {
        sourceType: KbDocumentSourceType.PASTE,
        title: OWNER_NOTES_TITLE,
        text,
        tags: ['onboarding', 'owner-notes', 'working-copy'],
      } as never);
      const fresh = (await this.drafts.findById(draft.id)) ?? draft;
      await this.drafts.update(fresh, {
        source: { ...fresh.source, workingNotesDocumentId: document.id },
      });
      return document.id;
    } catch (error) {
      this.logger.warn(
        `Working notes not written for chatbot ${ctx.chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return existing;
    }
  }

  // ── going live and Apply ───────────────────────────────────────────────

  /** After the first publish: the working copy agrees with live from here on. */
  async markLive(draftId: string): Promise<void> {
    const ctx = await this.forDraft(draftId);
    const live = await this.liveValues(ctx.chatbot, ctx.draft);
    await this.drafts.markLive(draftId, baseOf(live));
  }

  /**
   * Apply: publish the pending working-copy changes to the live chatbot.
   *
   * 1. Every pending value is parsed as the live side will store it; one invalid value refuses the
   *    whole Apply (400 with the field) before anything is written.
   * 2. At $0 the safety-relevant fields are not applied (`credits_required` each); the rest are.
   * 3. The safety check runs once, only when a safety-relevant field is applied, and fails closed:
   *    refused (422 `safety_conflict`) or not checked (503 `check_unavailable`) writes nothing.
   * 4. The fields are written; the merge base moves to the values written.
   */
  async apply(ctx: WorkingCopyContext, only?: string[]) {
    if (!ctx.live) {
      throw new ConflictException({
        errorCode: 'not_live',
        message:
          'This assistant isn’t live yet, so your changes already apply as you make them.',
      });
    }
    const synced = await this.sync(ctx);
    let draft = synced.draft;
    const changes = (await this.diff(draft, synced.live, synced)).filter(
      (c) => !only?.length || only.includes(c.field),
    );
    if (!changes.length) {
      return {
        applied: [] as string[],
        notApplied: [] as { field: string; errorCode: string }[],
        warnings: [] as { field: string; message: string }[],
        liveVersion: fieldVersion(synced.live),
        pending: [] as PendingChange[],
      };
    }

    // 1. Parse everything first.
    for (const change of changes) {
      const name = HOME_WRITES[change.field as StagedField];
      if (!name) continue;
      try {
        homeField(name)!.parse(change.working);
      } catch (error) {
        if (error instanceof HomeFieldInvalid) {
          throw new BadRequestException({
            errorCode: 'invalid_value',
            message: error.message,
            details: { field: change.field },
          });
        }
        throw error;
      }
    }

    // 2. Credits.
    const builder = ctx.chatbot.createdBy ?? null;
    const hasCredits = this.credits
      ? await this.credits.creditsAvailable(builder)
      : true;
    const notApplied: { field: string; errorCode: string }[] = [];
    let toApply = changes;
    if (!hasCredits) {
      toApply = changes.filter((c) => !c.safetyRelevant);
      for (const c of changes.filter((c) => c.safetyRelevant)) {
        notApplied.push({ field: c.field, errorCode: CREDITS_REQUIRED });
      }
    }

    // 3. The safety check, failing closed.
    const safetyChanges = toApply.filter((c) => c.safetyRelevant);
    let warnings: { field: string; message: string }[] = [];
    if (safetyChanges.length) {
      const result = await this.safety
        .check({
          chatbotId: ctx.chatbot.id,
          draftId: draft.id,
          builderUserId: builder,
          safetyPackId: draft.draftConfig.safetyPackId ?? null,
          changes: safetyChanges.map((c) => ({
            field: c.field,
            live: c.live,
            working: c.working,
          })),
        })
        .catch(() => null);
      if (!result || !result.ok) {
        const body = {
          errorCode:
            result && !result.ok ? result.errorCode : 'check_unavailable',
          message:
            result && !result.ok
              ? result.message
              : "Couldn't check this right now. Try again in a minute.",
          details: { field: result && !result.ok ? result.field : null },
        };
        throw body.errorCode === 'safety_conflict'
          ? new UnprocessableEntityException(body)
          : new ServiceUnavailableException(body);
      }
      warnings = result.warnings;
    }

    // 4. Write.
    const applied: string[] = [];
    for (const change of toApply) {
      try {
        await this.write(ctx.chatbot, draft, change);
        applied.push(change.field);
      } catch (error) {
        if (error instanceof SafetyLockedError) {
          throw new BadRequestException({
            errorCode: 'safety_locked',
            message: error.message,
            details: { field: change.field, applied },
          });
        }
        throw error;
      }
    }
    // The merge base follows what was written.
    const freshChatbot =
      (await this.chatbots.findOne({ where: { id: ctx.chatbot.id } })) ??
      ctx.chatbot;
    draft = (await this.drafts.findById(draft.id)) ?? draft;
    const after = await this.liveValues(freshChatbot, draft);
    const base = { ...(draft.liveBase ?? {}) };
    for (const field of applied) {
      if (field !== SOURCES_FIELD) {
        base[field] = fieldVersion(after[field as StagedField]);
      }
    }
    const source = { ...draft.source };
    if (applied.includes(SOURCES_FIELD)) {
      await this.drafts.removePendingDocuments(
        draft.id,
        synced.draft.source?.pendingDocumentIds ?? [],
      );
      draft = (await this.drafts.findById(draft.id)) ?? draft;
      source.pendingDocumentIds = draft.source?.pendingDocumentIds ?? [];
      source.factsStaged = false;
    }
    draft = await this.drafts.update(draft, { liveBase: base, source });
    const remaining = await this.diff(
      draft,
      after,
      mergeWithLive(workingValues(draft.draftConfig), after, base),
    );
    return {
      applied,
      notApplied,
      warnings,
      liveVersion: fieldVersion(after),
      pending: remaining,
    };
  }

  /** One pending change onto the live chatbot. */
  private async write(
    chatbot: Chatbot,
    draft: BotDraftEntity,
    change: PendingChange,
  ): Promise<void> {
    const field = change.field;
    const home = HOME_WRITES[field as StagedField];
    if (home) {
      await this.home.saveField(
        chatbot.id,
        {
          field: home,
          value: change.working,
          version: change.liveVersion,
        },
        { checked: true },
      );
      return;
    }
    if (field === 'languages') {
      const languages = change.working as string[];
      const fresh =
        (await this.chatbots.findOne({ where: { id: chatbot.id } })) ?? chatbot;
      await this.chatbots.update({ id: chatbot.id }, {
        persona: {
          ...(fresh.persona ?? {}),
          defaultLanguage: languages[0] ?? 'en',
          languages,
        },
        // Stage 5: the live chatbot replies only in its enabled languages.
        settings: {
          ...(fresh.settings ?? {}),
          ...enabledLanguagesPatch(languages),
        },
      } as never);
      if (await this.pages.findForChatbot(chatbot.id)) {
        const view = await this.pages.view(fresh);
        await this.home.saveField(
          chatbot.id,
          {
            field: 'language',
            value: pageLanguage(languages),
            version: fieldVersion(view.settings.language),
          },
          { record: false, checked: true },
        );
      }
      return;
    }
    if (field === 'extraNever') {
      const fresh =
        (await this.chatbots.findOne({ where: { id: chatbot.id } })) ?? chatbot;
      await this.chatbots.update({ id: chatbot.id }, {
        rules: { ...(fresh.rules ?? {}), never: change.working as string[] },
      } as never);
      return;
    }
    if (field === 'ownerNotes') {
      const id = await this.publisher.ownerNotes(draft, {
        ownerNotes: String(change.working ?? ''),
      });
      if (id !== (draft.source?.ownerNotesDocumentId ?? null)) {
        const fresh = (await this.drafts.findById(draft.id)) ?? draft;
        await this.drafts.update(fresh, {
          source: { ...fresh.source, ownerNotesDocumentId: id },
        });
      }
      return;
    }
    if (field === SOURCES_FIELD) {
      for (const documentId of draft.source?.pendingDocumentIds ?? []) {
        await this.drafts.attachDocument(draft, documentId);
      }
      if (draft.source?.factsStaged) {
        await this.publisher.learnedFacts(draft);
      }
    }
  }
}

/** A working copy made from a chatbot that has none: the live chatbot, field for field. */
export function configFromLive(
  chatbot: Chatbot,
  live: Record<StagedField, unknown>,
): BotDraft {
  const config = BotDraftService.defaultDraft(
    String(live.name || chatbot.name),
  );
  return {
    ...config,
    ...(live as unknown as Partial<BotDraft>),
    assistantName: String(live.assistantName || config.assistantName),
    tone: String(live.tone || config.tone) as BotDraft['tone'],
    safetyPackId: (chatbot.safetyPack ??
      config.safetyPackId) as BotDraft['safetyPackId'],
  };
}

export function baseOf(live: Record<StagedField, unknown>) {
  const base: Record<string, string> = {};
  for (const field of STAGED_FIELDS) base[field] = fieldVersion(live[field]);
  return base;
}
