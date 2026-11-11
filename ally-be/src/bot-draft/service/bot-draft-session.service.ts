import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  BuilderDesignCard,
  BuilderGap,
  BuilderStepRequest,
  BuilderStepResponse,
} from '../../ai/dto/builder.dto';
import { AiService } from '../../ai/service/ai.service';
import { KbIngestService } from '../../knowledge-base/service/kb-ingest.service';
import { LoggerService } from '../../logger/logger.service';
import { ONBOARDING_COPY, fill } from '../copy/onboarding-copy';
import type { CrawlLearner, LearnablePage } from '../crawl/site-crawl.service';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftActor,
  BotDraftStatus,
  BotDraftStep,
  Industry,
  PurposeId,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { packFor, packForBusiness } from '../safety-pack/safety-packs';
import type {
  CrawlProblem,
  LearnedFact,
  PatchOp,
  TranscriptEntry,
} from '../type/bot-draft.type';
import { BotDraftEventsService } from './bot-draft-events.service';
import {
  BotDraftService,
  DraftPatchRefused,
  OWNER_SOURCE,
} from './bot-draft.service';
import { STEP_ORDER, canAdvance } from './step-machine';

/** The builder's prompts, sent with each request so the Skills Store's live text runs. */
const BUILDER_PROMPT_CODES = [
  'ally_ai_builder_system',
  'ally_ai_builder_extract',
  'ally_ai_builder_classify',
  'ally_ai_builder_gaps',
  'ally_ai_builder_purposes',
  'ally_ai_builder_draft',
] as const;

/** Builder conversation sent with a step, most recent last. */
const HISTORY_TURNS = 40;
/** Facts listed as "already known" to fact extraction. */
const KNOWN_FACTS = 200;

/** What the draft stores about the conversation, in `answers`. */
interface ConversationState {
  values: Record<string, string>;
  pending: string;
  gaps: BuilderGap[] | null;
}

export type SessionEvent =
  | { event: 'status'; data: { code: string; label: string } }
  | { event: 'token'; data: { text: string } }
  | { event: 'message'; data: TranscriptEntry };

export interface TurnResult {
  message: TranscriptEntry;
  step: BotDraftStep;
  questionsLeft: number;
  version: number;
  draft: BotDraftEntity;
}

/**
 * The builder conversation (chunk 20a): sends one owner message to ally-ai's builder, relays its
 * live events, and applies what it proposes through `BotDraftService` — which checks every patch
 * (paths, schema, safety lock) before anything is written. Also the crawl's learner: each batch of
 * pages read goes to the builder's fact extraction, and the facts land in "What we learned".
 *
 * Nothing here logs what the owner wrote or what a page says: draft ids, steps and counts only.
 */
@Injectable()
export class BotDraftSessionService implements CrawlLearner {
  private readonly logger = LoggerService.getInstance(
    BotDraftSessionService.name,
  );

  constructor(
    private readonly drafts: BotDraftService,
    private readonly events: BotDraftEventsService,
    private readonly ai: AiService,
    private readonly documents: KbIngestService,
  ) {}

  // ── the conversation ──────────────────────────────────────────────────

  /**
   * One owner message (or quick reply). `emit` gets the builder's `status` events live; its
   * message is sent as `message` notes (anything ally-be adds, like the safety pack's own words)
   * and then `token`s, only after the proposal has been applied, so the chat never shows a
   * reply whose changes were refused.
   */
  async turn(
    draft: BotDraftEntity,
    input: { text?: string; chip?: string },
    emit: (event: SessionEvent) => void,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    if (draft.status !== BotDraftStatus.ACTIVE) {
      throw new ConflictException({
        errorCode: 'draft_closed',
        message: 'This setup is finished. Open the assistant to change it.',
      });
    }
    const text = (input.text ?? '').trim();
    const chip = (input.chip ?? '').trim();
    if (!text && !chip) {
      throw new BadRequestException('Write a message or choose a reply.');
    }

    // The owner's message is saved with the reply, not before it: a turn that's stopped (or
    // fails) leaves the draft exactly as it was.
    const said = text || chipLabel(draft, chip);
    const request = await this.stepRequest(draft, text, chip);
    const tokens: string[] = [];
    const response = await this.ai.runBuilderStepStreaming(
      request,
      (event) => {
        // Tokens wait for the proposal to be applied; status goes out live.
        if (event.event === 'token') tokens.push(event.data.text);
        else emit(event);
      },
      signal,
    );
    signal?.throwIfAborted();
    return this.apply(draft.id, said, response, emit, tokens);
  }

  /** The step request: the whole draft, as ally-ai keeps nothing between steps. */
  async stepRequest(
    draft: BotDraftEntity,
    message: string,
    chip: string,
  ): Promise<BuilderStepRequest> {
    const state = conversation(draft);
    const pack = packFor(draft.draftConfig.safetyPackId);
    return {
      draft_id: draft.id,
      step: draft.step,
      message,
      chip,
      draft: draft.draftConfig,
      learned: draft.learned,
      answers: state.values,
      pending: state.pending,
      industry: draft.industry ?? null,
      gaps: state.gaps,
      designs: designCards(draft),
      pages: (draft.crawl?.pages ?? [])
        .filter((page) => page.status === 'read')
        .slice(0, 50)
        .map((page) => ({
          url: page.url,
          title: (page.title ?? '').slice(0, 300),
          headings: (page.headings ?? []).slice(0, 30),
          snippet: (page.snippet ?? '').slice(0, 600),
        })),
      safety_pack: {
        id: pack?.id ?? SafetyPackId.STANDARD,
        name: pack?.name ?? '',
        always: pack?.always ?? [],
        never: pack?.never ?? [],
        at_risk: pack?.atRisk ?? [],
      },
      description: (draft.source?.description ?? '').slice(0, 4000),
      history: draft.transcript.slice(-HISTORY_TURNS).map((entry) => ({
        role: entry.role,
        text: entry.text.slice(0, 4000),
      })),
      prompts: await this.promptMap(),
    };
  }

  /**
   * Apply a step's proposal to the draft as it is NOW (the owner may have edited it while the
   * builder was thinking). Patches the draft refuses are dropped and counted, never fatal: the
   * conversation goes on.
   */
  private async apply(
    draftId: string,
    said: string,
    response: BuilderStepResponse,
    emit: (event: SessionEvent) => void,
    tokens: string[],
  ): Promise<TurnResult> {
    let draft = await this.fresh(draftId);
    let refused = response.dropped_patches ?? 0;

    if (response.learned_patches?.length) {
      const result = await this.tryPatch(
        draft,
        response.learned_patches,
        'learned',
      );
      draft = result.draft;
      refused += result.refused;
    }

    const notes: Omit<TranscriptEntry, 'id' | 'at'>[] = [];
    if (response.industry && draft.step === BotDraftStep.LEARNED) {
      const industry = response.industry as Industry;
      const packId = packForBusiness(industry, response.care_topics ?? []);
      draft = await this.drafts.setSafety(draft, industry, packId);
      const pack = packFor(draft.draftConfig.safetyPackId)!;
      notes.push({ role: 'builder', text: pack.builderMessage });
    }

    if (response.patches?.length) {
      const result = await this.tryPatch(draft, response.patches, 'draft');
      draft = result.draft;
      refused += result.refused;
      draft = await this.purposeDefaults(draft, response.patches);
    }

    const state = conversation(draft);
    if (response.answer && state.pending) {
      state.values[state.pending] = response.answer.slice(0, 2000);
    }
    state.pending = response.asking ?? '';
    if (response.gaps) state.gaps = response.gaps;
    draft = await this.drafts.update(draft, {
      answers: { ...state } as unknown as Record<string, unknown>,
      design: response.designs
        ? { cards: response.designs }
        : (draft.design ?? {}),
    });

    draft = await this.walkTo(draft, response.next_step as BotDraftStep);

    const message: Omit<TranscriptEntry, 'id' | 'at'> = {
      role: 'builder',
      text: response.message,
      ...(response.chips?.length ? { chips: response.chips } : {}),
    };
    draft = await this.drafts.appendTranscript(draft, [
      { role: 'owner', text: said },
      ...notes,
      message,
    ]);
    const added = draft.transcript.slice(-(notes.length + 1));
    for (const note of added.slice(0, -1)) {
      emit({ event: 'message', data: note });
    }
    for (const text of tokens) emit({ event: 'token', data: { text } });

    if (refused) {
      this.logger.info(
        `Builder step for draft ${draft.id}: ${refused} proposed change(s) refused`,
      );
    }
    return {
      message: added[added.length - 1],
      step: draft.step,
      questionsLeft: response.questions_left ?? 0,
      version: draft.version,
      draft,
    };
  }

  /** Move forward one step at a time to `target`; never back, never into published. */
  private async walkTo(
    draft: BotDraftEntity,
    target: BotDraftStep,
  ): Promise<BotDraftEntity> {
    const to = STEP_ORDER.indexOf(target);
    if (to < 0) return draft;
    while (STEP_ORDER.indexOf(draft.step) < to) {
      const next = STEP_ORDER[STEP_ORDER.indexOf(draft.step) + 1];
      if (!canAdvance(draft.step, next)) break;
      draft = await this.drafts.advance(draft, next);
    }
    return draft;
  }

  /**
   * The defaults a purpose sets that the builder can't (chunk 20a-2): Train my team is for the
   * business's own staff, so it's organisation-only, unless the owner already chose who can use
   * it. Only a default: the owner changes it on Share.
   */
  private async purposeDefaults(
    draft: BotDraftEntity,
    ops: PatchOp[],
  ): Promise<BotDraftEntity> {
    const chose = ops.some(
      (op) => op.path === '/purpose' && op.value === PurposeId.TRAINING,
    );
    const access = draft.draftConfig.access;
    const untouched =
      access.mode === 'invite' &&
      !access.emails.length &&
      !access.organisationIds.length;
    if (!chose || !untouched) return draft;
    const { draft: next } = await this.drafts.applyPatch(
      draft,
      [{ op: 'replace', path: '/access/mode', value: 'organisation' }],
      BotDraftActor.SYSTEM,
      {
        target: 'draft',
        summary: 'Set it to your organisation, for your team',
      },
    );
    return next;
  }

  private async tryPatch(
    draft: BotDraftEntity,
    ops: PatchOp[],
    target: 'draft' | 'learned',
  ): Promise<{ draft: BotDraftEntity; refused: number }> {
    let refused = 0;
    // One at a time, so one refused change doesn't take the rest with it.
    for (const op of ops) {
      try {
        draft = (
          await this.drafts.applyPatch(draft, [op], BotDraftActor.BUILDER, {
            target,
          })
        ).draft;
      } catch (error) {
        if (error instanceof DraftPatchRefused) {
          refused += 1;
          continue;
        }
        if (error instanceof ConflictException) {
          draft = await this.fresh(draft.id);
          refused += 1;
          continue;
        }
        throw error;
      }
    }
    return { draft, refused };
  }

  // ── the crawl's learner ───────────────────────────────────────────────

  /** Facts from a batch of pages, into "What we learned", each sourced to its page. */
  async learnFrom(draftId: string, pages: LearnablePage[]): Promise<void> {
    if (!pages.length) return;
    const draft = await this.fresh(draftId);
    const result = await this.ai.extractOnboardingFacts({
      draft_id: draftId,
      pages: pages.map((page) => ({
        url: page.url,
        title: (page.title ?? '').slice(0, 300),
        text: page.text.slice(0, 12_000),
      })),
      known: draft.learned.facts
        .slice(-KNOWN_FACTS)
        .map((fact) => fact.text.slice(0, 500)),
      prompts: await this.promptMap(),
    });
    // The builder may only cite a page we read; ally-ai checks, and so do we.
    const urls = new Set(pages.map((page) => page.url));
    // A description the owner wrote is read like a page, and its details are theirs.
    const facts: LearnedFact[] = [];
    let dropped = result.dropped ?? 0;
    for (const fact of result.facts ?? []) {
      if (!urls.has(fact.source_url)) {
        dropped += 1;
        continue;
      }
      facts.push({
        id: randomUUID(),
        section: fact.section as LearnedFact['section'],
        text: fact.text.slice(0, 500),
        sourceUrl: fact.source_url,
        sourceTitle: fact.source_title || null,
        ...(fact.source_url === OWNER_SOURCE ? { byOwner: true } : {}),
      });
    }
    await this.withRetry(draftId, async (current) => {
      let next = current;
      if (facts.length) {
        next = (
          await this.drafts.applyPatch(
            next,
            facts.map((value) => ({ op: 'add', path: '/facts/-', value })),
            BotDraftActor.BUILDER,
            { target: 'learned', summary: `Learned ${facts.length} details` },
          )
        ).draft;
      }
      if (dropped) {
        await this.drafts.applyPatch(
          next,
          [
            {
              op: 'replace',
              path: '/dropped',
              value: (next.learned.dropped ?? 0) + dropped,
            },
          ],
          BotDraftActor.SYSTEM,
          { target: 'learned', summary: 'Unsourced details dropped' },
        );
      }
    });
    if (result.business_name)
      await this.nameFromSource(draftId, result.business_name);
    // Running totals over everything learned so far, not this batch's own counts.
    for (const text of findingLines(
      (await this.fresh(draftId)).learned.facts,
    )) {
      await this.events.publish(draftId, { type: 'finding', text });
    }
    this.logger.info(
      `Learned ${facts.length} details from ${pages.length} pages for draft ${draftId} (${dropped} dropped)`,
    );
  }

  /**
   * "Upload documents instead": an uploaded document is read like a site, a page at a time (a
   * PDF's own pages; other formats in parts), and each detail is sourced to the document and page.
   * Same rule as the crawl: a detail that cites no part we sent is dropped.
   */
  async learnFromDocument(draftId: string, documentId: string): Promise<void> {
    const draft = await this.fresh(draftId);
    const read = await this.documents.readForOnboarding(documentId);
    if (!read || !draft.chatbotId || read.ownerChatbotId !== draft.chatbotId) {
      throw new ConflictException('That document is not part of this setup.');
    }
    await this.drafts.addKnowledgeDocument(draftId, documentId);
    const parts = documentParts(documentId, read);
    try {
      for (let i = 0; i < parts.length; i += DOCUMENT_BATCH) {
        await this.learnFrom(draftId, parts.slice(i, i + DOCUMENT_BATCH));
      }
    } catch (error) {
      // Never a silent dead end: the owner hears it went wrong, and their progress is kept.
      await this.crawlFinished(draftId, { read: 0, problem: 'generic' });
      throw error;
    }
    await this.crawlFinished(draftId, { read: parts.length });
  }

  /** "Describe it instead": the description is read for facts, sourced to the owner. */
  async learnFromDescription(
    draftId: string,
    description: string,
  ): Promise<void> {
    try {
      await this.learnFrom(draftId, [
        {
          url: OWNER_SOURCE,
          title: 'From you',
          status: 'read',
          text: description.slice(0, 4000),
        },
      ]);
    } catch (error) {
      await this.crawlFinished(draftId, { read: 0, problem: 'generic' });
      throw error;
    }
    await this.withRetry(draftId, async (draft) => {
      const saved = await this.drafts.appendTranscript(draft, [
        {
          role: 'builder',
          text: ONBOARDING_COPY.describedDone,
          chips: [ONBOARDING_COPY.looksRight],
        },
      ]);
      await this.events.publish(draftId, {
        type: 'message',
        entry: saved.transcript[saved.transcript.length - 1],
      });
    });
  }

  /**
   * The business's own name, from its site or documents, in place of the placeholder the draft
   * started with ("Thelivelovelaughfoundation", "Your business"). Once only, and never over a
   * name the owner chose.
   */
  private async nameFromSource(draftId: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 120);
    await this.withRetry(draftId, async (draft) => {
      const auto = draft.source?.autoName;
      const config = draft.draftConfig;
      if (!clean || !auto || config.name !== auto) return;
      const ops: PatchOp[] = [{ op: 'replace', path: '/name', value: clean }];
      if (config.assistantName === auto.slice(0, 60)) {
        ops.push({
          op: 'replace',
          path: '/assistantName',
          value: clean.slice(0, 60),
        });
      }
      if (config.branding.title === auto.slice(0, 80)) {
        ops.push({
          op: 'replace',
          path: '/branding/title',
          value: clean.slice(0, 80),
        });
      }
      if (config.branding.assistantName === auto.slice(0, 60)) {
        ops.push({
          op: 'replace',
          path: '/branding/assistantName',
          value: clean.slice(0, 60),
        });
      }
      const { draft: named } = await this.drafts.applyPatch(
        draft,
        ops,
        BotDraftActor.SYSTEM,
        { target: 'draft', summary: `Named ${clean}` },
      );
      await this.drafts.update(named, {
        source: { ...named.source, autoName: null },
      });
    });
  }

  /** The crawl ended: the builder says what it found, or what went wrong (copy §3, §13). */
  async crawlFinished(
    draftId: string,
    outcome: { read: number; domain?: string; problem?: CrawlProblem },
  ): Promise<void> {
    const text = outcome.problem
      ? fill(ONBOARDING_COPY.problems[outcome.problem], {
          domain: outcome.domain ?? 'your site',
          n: outcome.read,
        })
      : fill(ONBOARDING_COPY.readingDone, { n: outcome.read });
    const chips: string[] =
      outcome.problem && outcome.problem !== 'script_heavy'
        ? [...ONBOARDING_COPY.problemChips]
        : [ONBOARDING_COPY.looksRight];
    await this.withRetry(draftId, async (draft) => {
      const saved = await this.drafts.appendTranscript(draft, [
        { role: 'builder', text, chips },
      ]);
      await this.events.publish(draftId, {
        type: 'message',
        entry: saved.transcript[saved.transcript.length - 1],
      });
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async fresh(draftId: string): Promise<BotDraftEntity> {
    const draft = await this.drafts.findById(draftId);
    if (!draft) throw new ConflictException('That setup was not found.');
    return draft;
  }

  /** Run a write against the latest draft, again if someone wrote first. */
  private async withRetry(
    draftId: string,
    write: (draft: BotDraftEntity) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await write(await this.fresh(draftId));
        return;
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt >= 4) throw error;
      }
    }
  }

  private async promptMap(): Promise<Record<string, unknown>> {
    try {
      return await this.ai.getPromptOverrides(BUILDER_PROMPT_CODES);
    } catch {
      // ally-ai's own defaults are sane; not worth failing a step over.
      return {};
    }
  }
}

/** Copy §3's finding lines for the facts learned so far. */
export function findingLines(facts: LearnedFact[]): string[] {
  const counts = new Map<string, number>();
  for (const fact of facts)
    counts.set(fact.section, (counts.get(fact.section) ?? 0) + 1);
  return Object.entries(ONBOARDING_COPY.findings)
    .filter(([section]) => counts.get(section))
    .map(([section, line]) => fill(line, { n: counts.get(section)! }));
}

/** Parts of one document sent to fact extraction together, as with crawled pages. */
const DOCUMENT_BATCH = 8;
/** Most parts read from one document (a long PDF's first 50 pages). */
const DOCUMENT_PARTS = 50;
const PART_CHARS = 8_000;

/**
 * A document as "pages" for extraction. A PDF's own pages, each sourced as
 * `document:<id>#page=<n>` and titled "<name>, page <n>"; any other format in parts of about
 * 8,000 characters, titled with its name.
 */
export function documentParts(
  documentId: string,
  read: {
    title: string;
    fileName: string | null;
    extracted: {
      text: string;
      pages: { number: number; start: number; end: number }[];
    };
  },
): LearnablePage[] {
  const name = (read.fileName || read.title || 'Your document').slice(0, 200);
  const { text, pages } = read.extracted;
  const parts: LearnablePage[] = [];
  if (pages.length) {
    for (const page of pages) {
      const body = text.slice(page.start, page.end).trim();
      if (!body) continue;
      parts.push({
        url: `document:${documentId}#page=${page.number}`,
        title: `${name}, page ${page.number}`,
        status: 'read',
        text: body.slice(0, 12_000),
      });
    }
  } else {
    let start = 0;
    let n = 1;
    while (start < text.length) {
      let end = Math.min(text.length, start + PART_CHARS);
      const paragraph = text.lastIndexOf('\n\n', end);
      if (end < text.length && paragraph > start + PART_CHARS / 2)
        end = paragraph;
      const body = text.slice(start, end).trim();
      if (body) {
        parts.push({
          url: `document:${documentId}#part=${n}`,
          title: name,
          status: 'read',
          text: body,
        });
        n += 1;
      }
      start = end;
    }
  }
  return parts.slice(0, DOCUMENT_PARTS);
}

/** How a quick reply reads in the chat: a design by its card's title, not its id. */
function chipLabel(draft: BotDraftEntity, chip: string): string {
  if (!chip.startsWith('design:')) return chip;
  const id = chip.slice('design:'.length);
  return designCards(draft)?.find((card) => card.id === id)?.title ?? id;
}

/** The conversation state kept in `answers`, with defaults for a new draft. */
export function conversation(draft: BotDraftEntity): ConversationState {
  const raw = (draft.answers ?? {}) as Partial<ConversationState>;
  return {
    values: { ...(raw.values ?? {}) },
    pending: typeof raw.pending === 'string' ? raw.pending : '',
    gaps: Array.isArray(raw.gaps) ? raw.gaps : null,
  };
}

export function designCards(draft: BotDraftEntity): BuilderDesignCard[] | null {
  const cards = (draft.design as { cards?: BuilderDesignCard[] })?.cards;
  return Array.isArray(cards) ? cards : null;
}
