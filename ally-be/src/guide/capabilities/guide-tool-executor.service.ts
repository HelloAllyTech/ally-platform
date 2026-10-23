import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { CourseSpine } from '../conductor/course-spine';
import { GuideLearnerDataService } from '../learner/guide-learner-data.service';
import {
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideCallAttribution } from '../runtime/guide-model.service';
import { LIVE_ITEM_CARD_SQL } from '../runtime/guide-thread.service';
import { SentinelOverlay } from '../safety/sentinel';
import { GuideTutorService } from './specialists/guide-tutor.service';
import { SteerDecision, afterReflection } from '../conductor/pacing';
import {
  SIDE_QUEST_KINDS,
  SideQuestKind,
  SideQuestSlot,
} from '../conductor/side-quests';
import { GuideSideQuestService } from '../runtime/guide-side-quest.service';
import { GuideCard as GuideCardEvent } from '../contract/generated/guide-contract';
import { itemTypeLabel } from '../context/guide-context';
import { GuideCard } from '../entity/guide-card.entity';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideOrgProfileValue } from '../entity/guide-org-profile.entity';
import { GuideThreadPacing } from '../entity/guide-thread.entity';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
  GuideMemoryKind,
  GuideMode,
  GuideNotebookKind,
} from '../enum/guide.enum';
import { resolveSupportLines } from '../safety/fixed-responses';
import {
  CTA_LABEL_BY_TYPE,
  GUIDE_TOOL_NAMES,
  GUIDE_VISITOR_TOOL_NAMES,
  SIGN_IN_SUGGESTION_GAP_TURNS,
  PRESENTATION_BY_TYPE,
  PresentReason,
  checkPresentable,
} from './guide-tools';

/** Everything a tool may read or change during one turn. */
export interface GuideToolContext {
  threadId: string;
  turnId: string;
  userId: number;
  tenantId: string;
  courseTitle: string;
  courseDescription: string | null;
  language: string;
  mode: GuideMode;
  spine: CourseSpine;
  steer: SteerDecision;
  orgProfile: GuideOrgProfileValue | null;
  /** Mutable: tools update it and the turn persists it once. */
  pacing: GuideThreadPacing;
  /** Cards presented this turn, in order. */
  presented: GuideCardEvent[];
  emitDurable(type: string, data: Record<string, unknown>): Promise<number>;
  trackId: string;
  bundle: GuideReleaseBundle;
  tier?: GuideBudgetTier;
  attribution: GuideCallAttribution;
  onCost?: (usd: number) => void;
  /** The Sentinel's overlay on this message (real case, identifying details). */
  overlay: SentinelOverlay;
  memoryEnabled: boolean;
  /** What the learner has written lately, newest last — notebook text must come from here. */
  learnerTexts: string[];
  epochNumber: number;
  /** An anonymous visitor's turn: only the visitor tools may run. */
  anonymous?: boolean;
  /** The Conductor's side-quest slot this turn (plan §4.6). */
  sideQuest?: SideQuestSlot | null;
  sideQuestDifficulty?: 'gentle' | 'standard' | 'stretch';
  /** The learner switched side quests off (they can still ask for one). */
  sideQuestsOn?: boolean;
  /** The platform started this turn (a completion, a grade): the learner said nothing new. */
  platformTurn?: boolean;
  /** When the current epoch began (ISO): cards from before it have scrolled away. */
  epochStartedAt?: string | null;
  learnerMessageId?: string;
}

export interface GuideToolResult {
  content: string;
  isError: boolean;
  /** A short caption for the "thinking" presence while it runs. */
  activity?: string;
}

const ok = (payload: Record<string, unknown>): GuideToolResult => ({
  content: JSON.stringify(payload),
  isError: false,
});
const fail = (error: string): GuideToolResult => ({
  content: JSON.stringify({ error }),
  isError: true,
});

/** Captions for the presence orb while a tool runs (plan §5.1 principle 5). */
export const TOOL_ACTIVITY: Record<string, string> = {
  [GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM]: 'Getting the next activity ready',
  [GUIDE_TOOL_NAMES.SHOW_COURSE_INFO]: 'Opening the course overview',
  [GUIDE_TOOL_NAMES.GET_PROGRESS]: 'Checking where you are',
  [GUIDE_TOOL_NAMES.SHOW_WELLBEING_RESOURCES]: 'Finding support for you',
  [GUIDE_TOOL_NAMES.CONSULT_TUTOR]: 'Checking the course material',
};

const QUIET_MODES = new Set([
  GuideMode.CARE,
  GuideMode.CRISIS,
  GuideMode.CRISIS_FOLLOWUP,
]);

/** Folded for "did the learner write this?": case, spacing, quotes, punctuation. */
const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when `text` (at least two words) appears in what the learner wrote. */
export function isLearnersOwnWords(
  text: string,
  learnerTexts: string[],
): boolean {
  const needle = fold(text);
  if (needle.split(' ').filter(Boolean).length < 2) return false;
  return learnerTexts.some((said) => fold(said).includes(needle));
}

/** Function words a memory note may add without the learner having said them. */
const NOTE_FILLER = new Set([
  'about',
  'after',
  'also',
  'been',
  'before',
  'being',
  'could',
  'does',
  'from',
  'have',
  'into',
  'just',
  'learner',
  'learners',
  'more',
  'most',
  'much',
  'only',
  'should',
  'some',
  'that',
  'their',
  'them',
  'they',
  'this',
  'very',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'would',
  'your',
]);

const contentWords = (text: string): string[] =>
  fold(text)
    .split(' ')
    .filter((word) => [...word].length >= 4 && !NOTE_FILLER.has(word));

/** Crude stem: the first four characters (letters and their marks). */
const stem = (word: string): string => [...word].slice(0, 4).join('');

/**
 * Whether a memory note is drawn from what the learner wrote, not made up:
 * at least half its content words share a stem with the learner's recent
 * words. A note is a paraphrase, so it cannot be held to their exact words
 * the way a notebook entry is — but a note with nothing in common with
 * anything they said is Ally's invention (seen in the 1.5 walk, where a
 * trigger turn asked "what helper do you want to become?" and stored its
 * own answer). Text mostly outside the Latin script is not judged: a note
 * written in English about a Hindi message would never match.
 */
export function isGroundedInLearnerWords(
  note: string,
  learnerTexts: string[],
): boolean {
  const said = learnerTexts.join(' ');
  const letters = said.match(/\p{L}/gu) ?? [];
  const latin = said.match(/\p{Script=Latin}/gu) ?? [];
  if (letters.length > 0 && latin.length / letters.length < 0.5) return true;
  const words = contentWords(note);
  if (words.length < 2) return words.length === 0 ? false : true;
  const heard = new Set(contentWords(said).map(stem));
  const matched = words.filter((word) => heard.has(stem(word))).length;
  return matched / words.length >= 0.5;
}

/**
 * Runs Ally's tools. Every failure is returned to the model as an error
 * result it can recover from, never thrown: a refused presentation should
 * become "let's finish this one first", not a failed turn.
 */
@Injectable()
export class GuideToolExecutorService {
  private readonly logger = LoggerService.getInstance(
    GuideToolExecutorService.name,
  );

  constructor(
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
    private readonly tutor: GuideTutorService,
    private readonly learnerData: GuideLearnerDataService,
    private readonly sideQuests: GuideSideQuestService,
  ) {}

  async execute(
    name: string,
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    // A visitor's Ally is offered only the visitor tools; a call to any other
    // (a model reaching for one it saw earlier) is refused here too.
    if (ctx.anonymous && !GUIDE_VISITOR_TOOL_NAMES.has(name)) {
      return fail('Not available before the learner signs in.');
    }
    if (!ctx.anonymous && name === GUIDE_TOOL_NAMES.SUGGEST_SIGN_IN) {
      return fail('The learner is already signed in.');
    }
    try {
      switch (name) {
        case GUIDE_TOOL_NAMES.SUGGEST_SIGN_IN:
          return await this.suggestSignIn(input, ctx);
        case GUIDE_TOOL_NAMES.PRESENT_MICRO_ACTIVITY:
          return await this.presentMicroActivity(input, ctx);
        case GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM:
          return await this.presentCourseItem(input, ctx);
        case GUIDE_TOOL_NAMES.SHOW_COURSE_INFO:
          return await this.showCourseInfo(ctx);
        case GUIDE_TOOL_NAMES.GET_PROGRESS:
          return this.getProgress(ctx);
        case GUIDE_TOOL_NAMES.MARK_REFLECTION_DONE:
          ctx.pacing = afterReflection(ctx.pacing);
          return ok({ done: true });
        case GUIDE_TOOL_NAMES.SHOW_WELLBEING_RESOURCES:
          return await this.showWellbeingResources(ctx);
        case GUIDE_TOOL_NAMES.SET_GUIDANCE:
          return await this.setGuidance(input, ctx);
        case GUIDE_TOOL_NAMES.CONSULT_TUTOR:
          return await this.consultTutor(input, ctx);
        case GUIDE_TOOL_NAMES.REMEMBER:
          return await this.remember(input, ctx);
        case GUIDE_TOOL_NAMES.SAVE_TO_NOTEBOOK:
          return await this.saveToNotebook(input, ctx);
        case GUIDE_TOOL_NAMES.RECORD_NOTICING:
          return await this.recordNoticing(input, ctx);
        case GUIDE_TOOL_NAMES.CLOSE_SESSION:
          return await this.closeSession(input, ctx);
        default:
          return fail(`Unknown tool ${name}.`);
      }
    } catch (error) {
      this.logger.warn(
        `Guide tool ${name} failed on turn ${ctx.turnId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fail('That did not work. Carry on without it.');
    }
  }

  private async presentCourseItem(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const check = checkPresentable({
      spine: ctx.spine,
      steer: ctx.steer,
      mode: ctx.mode,
      itemId: String(input.item_id ?? ''),
      reason: input.reason as PresentReason,
      alreadyPresentedThisTurn: ctx.presented.some(
        (card) => card.kind === GuideCardKind.COURSE_ITEM,
      ),
    });
    if (!check.ok) return fail(check.error);
    const { item } = check;
    const section = ctx.spine.sections[item.sectionIndex];
    const framing = String(input.framing ?? '').slice(0, 140) || null;
    const presentation =
      PRESENTATION_BY_TYPE[item.type] ?? GuideCardPresentation.SHELF;
    const reopening = item.state === 'completed';

    // The same step is still in view from earlier in this sitting: presenting
    // it again only stacks a duplicate card (seen in the 1.5 walk).
    if (!reopening) {
      const [live] = (await this.cards.query(LIVE_ITEM_CARD_SQL, [
        ctx.threadId,
        item.id,
        ctx.epochStartedAt ?? null,
      ])) as Array<{ id: string; state: string }>;
      if (live) {
        return ok({
          presented: false,
          alreadyOnScreen: true,
          state: live.state,
          next:
            live.state === GuideCardState.ACTIVE
              ? 'The learner already has this open. Do not present it again; let them carry on.'
              : 'This card is already on screen above. Do not present it again; point them to it in a few words.',
        });
      }
    }

    const saved = await this.cards.save(
      this.cards.create({
        threadId: ctx.threadId,
        kind: GuideCardKind.COURSE_ITEM,
        presentation,
        state: reopening ? GuideCardState.DONE : GuideCardState.READY,
        title: item.title.slice(0, 255),
        trackItemId: item.id,
        payload: { framing, reason: input.reason },
        tenantId: ctx.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.COURSE_ITEM,
      presentation,
      state: saved.state,
      title: item.title,
      framing,
      meta: {
        minutes: item.estimatedMinutes,
        format: itemTypeLabel(item.type),
      },
      cta: {
        label: reopening
          ? 'Open again'
          : (CTA_LABEL_BY_TYPE[item.type] ?? 'Open'),
        action: 'open',
      },
      trackItem: {
        id: item.id,
        type: item.type as any,
        title: item.title,
        sectionId: item.sectionId,
        sectionTitle: section?.title ?? null,
      },
    };
    const seq = await ctx.emitDurable('card.presented', { card });
    // The event as sent is what a reload restores (bootstrap's cards[]).
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...(saved.payload ?? {}), card } as Record<string, any>,
    });
    ctx.presented.push(card);
    return ok({
      presented: true,
      card: `${itemTypeLabel(item.type)} "${item.title}", about ${item.estimatedMinutes} minutes`,
      next:
        'The card is on screen. If your reply has not framed it yet, frame it in one ' +
        'sentence; if it already has, add nothing — never repeat what you wrote.',
    });
  }

  /**
   * The sign-in card (plan §3 stage 2, §5.12). Not as the first reply — an
   * ask before the visitor has had anything of value drives them away
   * (Stacks: Timing friend invites to First Major Win-State) — and not
   * again within a few turns.
   */
  private async suggestSignIn(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const turn = ctx.pacing.learnerTurns ?? 0;
    const last = ctx.pacing.signInOfferedAtTurn;
    if (last != null && turn - last < SIGN_IN_SUGGESTION_GAP_TURNS) {
      return fail(
        'You suggested signing in a moment ago; the card is still there. Answer them instead.',
      );
    }
    if (ctx.presented.some((card) => card.kind === GuideCardKind.SIGN_IN)) {
      return fail('The sign-in card is already on screen.');
    }
    const framing = String(input.reason ?? '').slice(0, 140) || null;
    const saved = await this.cards.save(
      this.cards.create({
        threadId: ctx.threadId,
        kind: GuideCardKind.SIGN_IN,
        presentation: GuideCardPresentation.INLINE,
        state: GuideCardState.READY,
        title: 'Sign in to keep going',
        payload: { framing },
        tenantId: null,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.SIGN_IN,
      presentation: GuideCardPresentation.INLINE,
      state: GuideCardState.READY,
      title: 'Sign in to keep going',
      framing,
      cta: { label: 'Sign in', action: 'sign_in' },
    };
    const seq = await ctx.emitDurable('card.presented', { card });
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...(saved.payload ?? {}), card } as Record<string, any>,
    });
    ctx.presented.push(card);
    ctx.pacing = { ...ctx.pacing, signInOfferedAtTurn: turn };
    return ok({
      shown: true,
      next: 'The card is on screen. Say in a sentence what signing in lets them do; do not repeat its text.',
    });
  }

  /**
   * A side quest (plan §4.6): only in an open slot or when the learner asked,
   * never in a hard moment, one a turn, on an item they have reached.
   */
  private async presentMicroActivity(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const kind = String(input.kind ?? '') as SideQuestKind;
    if (!SIDE_QUEST_KINDS.includes(kind)) return fail('Unknown kind.');
    if (QUIET_MODES.has(ctx.mode)) return fail('Not in this moment.');
    const asked = input.reason === 'learner_asked';
    if (!asked && !ctx.sideQuest?.open) {
      return fail(
        `No practice slot now (${ctx.sideQuest?.reason ?? 'not open'}). Offer one only if the learner asks.`,
      );
    }
    if (!asked && ctx.sideQuestsOn === false) {
      return fail('The learner switched practice off. Only if they ask.');
    }
    if (
      ctx.presented.some((card) => card.kind === GuideCardKind.MICRO_ACTIVITY)
    ) {
      return fail('One practice per turn.');
    }
    const focusId = input.focus_item_id ? String(input.focus_item_id) : null;
    if (focusId) {
      const focus = ctx.spine.items.find((item) => item.id === focusId);
      if (!focus) return fail('No such item in this course.');
      if (focus.state === 'locked' && kind !== 'rehearse_line') {
        return fail(
          'That item is not reached yet; practise on one they have done.',
        );
      }
    }
    const card = await this.sideQuests.present({
      threadId: ctx.threadId,
      tenantId: ctx.tenantId || null,
      trackId: ctx.trackId,
      kind,
      focusItemId: focusId,
      framing: String(input.framing ?? '').slice(0, 160) || null,
      spine: ctx.spine,
      languageCode: ctx.language,
      difficulty: ctx.sideQuestDifficulty ?? 'standard',
      bundle: ctx.bundle,
      tier: ctx.tier,
      attribution: ctx.attribution,
      onCost: ctx.onCost,
      emitDurable: ctx.emitDurable,
    });
    if (!card) {
      return fail(
        'Could not make that practice from what they have reached. Carry on without it.',
      );
    }
    ctx.presented.push(card);
    ctx.pacing = {
      ...ctx.pacing,
      sideQuest: {
        ...(ctx.pacing.sideQuest ?? {}),
        atCompleted: ctx.spine.completed,
        atTurn: ctx.pacing.learnerTurns ?? 0,
      },
    };
    return ok({
      presented: true,
      card: `practice "${card.title}"`,
      next: 'The card is on screen. Frame it in a sentence as optional; do not reveal answers.',
    });
  }

  private async showCourseInfo(
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const totalMinutes = ctx.spine.items.reduce(
      (sum, item) => sum + item.estimatedMinutes,
      0,
    );
    const saved = await this.cards.save(
      this.cards.create({
        threadId: ctx.threadId,
        kind: GuideCardKind.COURSE_INFO,
        presentation: GuideCardPresentation.SHELF,
        state: GuideCardState.READY,
        title: ctx.courseTitle.slice(0, 255),
        payload: { totalMinutes },
        tenantId: ctx.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.COURSE_INFO,
      presentation: GuideCardPresentation.SHELF,
      state: GuideCardState.READY,
      title: ctx.courseTitle,
      framing: null,
      meta: { minutes: totalMinutes, format: 'course' },
      cta: { label: 'About this course', action: 'open' },
      payload: {
        chapters: ctx.spine.sections.map((section) => ({
          title: section.title,
          items: section.itemIds.length,
        })),
        completed: ctx.spine.completed,
        total: ctx.spine.total,
      },
    };
    const seq = await ctx.emitDurable('card.presented', { card });
    // The event as sent is what a reload restores (bootstrap's cards[]).
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...(saved.payload ?? {}), card } as Record<string, any>,
    });
    ctx.presented.push(card);
    return ok({ shown: true, totalMinutes, items: ctx.spine.total });
  }

  private getProgress(ctx: GuideToolContext): GuideToolResult {
    const { spine } = ctx;
    return ok({
      completed: spine.completed,
      total: spine.total,
      finished: spine.finished,
      nextStep: spine.current
        ? { id: spine.current.id, title: spine.current.title }
        : null,
      chapters: spine.sections.map((section) => {
        const items = spine.items.filter(
          (item) => item.sectionId === section.id,
        );
        return {
          title: section.title,
          completed: items.filter((item) => item.state === 'completed').length,
          total: items.length,
        };
      }),
    });
  }

  private async showWellbeingResources(
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const lines = resolveSupportLines(ctx.orgProfile, ctx.language);
    const saved = await this.cards.save(
      this.cards.create({
        threadId: ctx.threadId,
        kind: GuideCardKind.RESOURCE,
        presentation: GuideCardPresentation.INLINE,
        state: GuideCardState.READY,
        title: 'Support, whenever you need it',
        payload: { lines },
        tenantId: ctx.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.RESOURCE,
      presentation: GuideCardPresentation.INLINE,
      state: GuideCardState.READY,
      title: 'Support, whenever you need it',
      framing: null,
      payload: { lines },
    };
    const seq = await ctx.emitDurable('card.presented', { card });
    // The event as sent is what a reload restores (bootstrap's cards[]).
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...(saved.payload ?? {}), card } as Record<string, any>,
    });
    ctx.presented.push(card);
    return ok({ shown: true, lines: lines.length });
  }

  private async setGuidance(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const level = input.level;
    if (!['lead', 'walk', 'drive'].includes(level)) {
      return fail('level must be lead, walk or drive.');
    }
    const existing = await this.prefs.findOne({
      where: { userId: ctx.userId, tenantId: ctx.tenantId },
    });
    await this.prefs.save({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      prefs: { ...(existing?.prefs ?? {}), guidance: level },
    });
    return ok({
      guidance: level,
      next: 'Takes effect from your next reply.',
    });
  }

  private async consultTutor(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    const question = String(input.question ?? '').trim();
    if (!question) return fail('Ask a question.');
    const answer = await this.tutor.consult({
      question,
      trackId: ctx.trackId,
      spine: ctx.spine,
      languageCode: ctx.language,
      bundle: ctx.bundle,
      tier: ctx.tier,
      attribution: ctx.attribution,
      onCost: ctx.onCost,
    });
    return ok({
      covered: answer.covered,
      answer: answer.answer,
      sources: answer.citations.map((c) => ({ item: c.title, quote: c.quote })),
      next: answer.covered
        ? 'Say it in your own words, briefly, and name where in the course it is covered.'
        : 'Tell the learner honestly that the course does not cover this.',
    });
  }

  private async remember(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    if (!ctx.memoryEnabled) {
      return fail(
        'The learner has switched memory off. Do not remember anything.',
      );
    }
    if (QUIET_MODES.has(ctx.mode) || ctx.overlay !== 'none') {
      return fail('Nothing is remembered from this kind of moment.');
    }
    if (ctx.platformTurn) {
      return fail(
        'The learner has not said anything this turn. Remember only what they tell you.',
      );
    }
    const kinds = Object.values(GuideMemoryKind) as string[];
    if (!kinds.includes(input.kind)) return fail('Unknown kind.');
    if (!isGroundedInLearnerWords(String(input.note ?? ''), ctx.learnerTexts)) {
      return fail(
        'That is not something the learner said. Remember only what they told you, in close to their words.',
      );
    }
    const policy = ctx.bundle.policy.memory;
    const result = await this.learnerData.remember({
      owner: { id: ctx.userId, tenantId: ctx.tenantId },
      kind: input.kind as GuideMemoryKind,
      body: String(input.note ?? ''),
      threadId: ctx.threadId,
      expiryDays: policy.expiryDays,
      maxChars: policy.noteMaxChars,
    });
    if (!result.stored) {
      return fail(
        result.reason === 'forgotten_before'
          ? 'The learner asked you to forget this before. Do not store it again.'
          : 'Nothing to remember.',
      );
    }
    return ok({ remembered: true, updated: result.updated });
  }

  private async saveToNotebook(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    if (ctx.mode === GuideMode.CRISIS) return fail('Not now.');
    const allowed = [
      GuideNotebookKind.POSSIBLE_SELF,
      GuideNotebookKind.REFLECTION,
      GuideNotebookKind.REHEARSED_LINE,
    ] as string[];
    if (!allowed.includes(input.kind)) return fail('Unknown kind.');
    const text = String(input.text ?? '').trim();
    if (!isLearnersOwnWords(text, ctx.learnerTexts)) {
      return fail(
        "The notebook holds the learner's own words: copy them exactly from what they wrote.",
      );
    }
    const entry = await this.learnerData.addToNotebook({
      owner: { id: ctx.userId, tenantId: ctx.tenantId },
      threadId: ctx.threadId,
      trackId: ctx.trackId,
      kind: input.kind as GuideNotebookKind,
      text,
      sourceMessageId: ctx.learnerMessageId ?? null,
    });
    await ctx.emitDurable('notebook.added', {
      entryId: entry.id,
      kind: entry.kind,
      text: entry.text,
    });
    return ok({ saved: true });
  }

  private async recordNoticing(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    if (QUIET_MODES.has(ctx.mode)) return fail('Not in this moment.');
    const used =
      ctx.pacing.noticing?.epoch === ctx.epochNumber
        ? ctx.pacing.noticing.count
        : 0;
    if (used >= ctx.bundle.policy.noticingMaxPerSession) {
      return fail(
        'Enough noticing for this session. Keep it rare so it means something.',
      );
    }
    const behaviour = String(input.behaviour ?? '').trim();
    if (behaviour.split(/\s+/).length < 4) {
      return fail('Name the specific behaviour.');
    }
    const evidence = String(input.evidence ?? '').trim();
    const entry = await this.learnerData.addToNotebook({
      owner: { id: ctx.userId, tenantId: ctx.tenantId },
      threadId: ctx.threadId,
      trackId: ctx.trackId,
      kind: GuideNotebookKind.NOTICING,
      text: evidence ? `${behaviour} (${evidence})` : behaviour,
    });
    ctx.pacing = {
      ...ctx.pacing,
      noticing: { epoch: ctx.epochNumber, count: used + 1 },
    };
    await ctx.emitDurable('notebook.added', {
      entryId: entry.id,
      kind: entry.kind,
      text: entry.text,
    });
    return ok({ saved: true });
  }

  private async closeSession(
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    if (ctx.mode === GuideMode.CRISIS) return fail('Not now.');
    if (ctx.pacing.closedEpoch === ctx.epochNumber) {
      return fail('The closing card is already on screen for this session.');
    }
    const payload = {
      noticing: String(input.noticing ?? '').slice(0, 280),
      watchFor: String(input.watch_for ?? '').slice(0, 280),
      teaser: String(input.teaser ?? '').slice(0, 200),
      // The client turns a choice into a time in the learner's zone and
      // saves it with PUT /v1/guide/threads/:id/appointment.
      options: [
        'tomorrow_morning',
        'after_shift',
        'this_weekend',
        'pick_a_time',
      ],
    };
    const saved = await this.cards.save(
      this.cards.create({
        threadId: ctx.threadId,
        kind: GuideCardKind.CLOSING_RITUAL,
        presentation: GuideCardPresentation.INLINE,
        state: GuideCardState.READY,
        title: 'Until next time',
        payload,
        tenantId: ctx.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.CLOSING_RITUAL,
      presentation: GuideCardPresentation.INLINE,
      state: GuideCardState.READY,
      title: 'Until next time',
      framing: null,
      payload,
    };
    const seq = await ctx.emitDurable('card.presented', { card });
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...payload, card } as Record<string, any>,
    });
    ctx.presented.push(card);
    ctx.pacing = { ...ctx.pacing, closedEpoch: ctx.epochNumber };
    return ok({
      shown: true,
      next: 'Say goodbye in a sentence. Do not repeat what is on the card.',
    });
  }
}
