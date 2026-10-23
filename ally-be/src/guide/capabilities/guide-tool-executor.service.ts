import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { CourseSpine } from '../conductor/course-spine';
import { SteerDecision, afterReflection } from '../conductor/pacing';
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
  GuideMode,
} from '../enum/guide.enum';
import { resolveSupportLines } from '../safety/fixed-responses';
import {
  CTA_LABEL_BY_TYPE,
  GUIDE_TOOL_NAMES,
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
};

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
  ) {}

  async execute(
    name: string,
    input: Record<string, any>,
    ctx: GuideToolContext,
  ): Promise<GuideToolResult> {
    try {
      switch (name) {
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
    await this.cards.update(saved.id, { presentedSeq: seq });
    ctx.presented.push(card);
    return ok({
      presented: true,
      card: `${itemTypeLabel(item.type)} "${item.title}", about ${item.estimatedMinutes} minutes`,
      next: 'The card is on screen. Frame it in a sentence and let the learner open it.',
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
    await this.cards.update(saved.id, { presentedSeq: seq });
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
    await this.cards.update(saved.id, { presentedSeq: seq });
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
}
