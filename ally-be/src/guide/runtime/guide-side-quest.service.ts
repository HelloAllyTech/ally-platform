import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssessorActivity,
  GuideAssessorService,
  gradeAssessorActivity,
} from '../capabilities/specialists/guide-assessor.service';
import {
  CoachActivity,
  GuideCoachService,
} from '../capabilities/specialists/guide-coach.service';
import { CourseSpine } from '../conductor/course-spine';
import { GuideCourseContentService } from '../content/guide-course-content.service';
import { SideQuestKind } from '../conductor/side-quests';
import { GuideCard as GuideCardEvent } from '../contract/generated/guide-contract';
import { itemTypeLabel } from '../context/guide-context';
import { GuideCard } from '../entity/guide-card.entity';
import { GuideThread, GuideThreadPacing } from '../entity/guide-thread.entity';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
} from '../enum/guide.enum';
import { AssessorKind, SideQuestDifficulty } from '../prompts/assessor.prompt';
import { CoachKind } from '../prompts/coach.prompt';
import {
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideEventBusService } from './guide-event-bus.service';
import { GuideCallAttribution } from './guide-model.service';
import { GuideThreadService } from './guide-thread.service';

const ASSESSOR_KINDS = new Set<SideQuestKind>([
  'quick_check',
  'micro_dilemma',
  'spaced_recall',
  'predict_beat',
]);

export type SideQuestSpec =
  | { source: 'assessor'; activity: AssessorActivity }
  | { source: 'coach'; activity: CoachActivity };

/** What the learner's card shows: never a key, never feedback before answering. */
export function learnerSafeActivity(spec: SideQuestSpec) {
  if (spec.source === 'assessor') {
    const { activity } = spec;
    return {
      kind: activity.kind,
      intro: activity.intro,
      questions: activity.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
        })),
      })),
    };
  }
  return {
    kind: spec.activity.kind,
    prompt: spec.activity.prompt,
    placeholder: spec.activity.placeholder,
  };
}

export interface SideQuestResult {
  cardId: string;
  kind: SideQuestKind;
  results?: Array<{
    questionId: string;
    correct: boolean;
    correctOptionId: string;
    feedback: string;
  }>;
  note?: string | null;
}

/**
 * Side quests end to end (plans/ally-guide/plan.md §4.6): a card made by the
 * Assessor (questions with a key) or the Coach (an open prompt), and the
 * learner's answer marked or noted. Ungraded: nothing here touches course
 * progress or XP. The key and the per-option feedback stay in the card row's
 * `payload.spec`, which no endpoint returns; the learner's card carries
 * `payload.card` only.
 */
@Injectable()
export class GuideSideQuestService {
  constructor(
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
    private readonly assessor: GuideAssessorService,
    private readonly coach: GuideCoachService,
    private readonly content: GuideCourseContentService,
    private readonly threads: GuideThreadService,
    private readonly bus: GuideEventBusService,
  ) {}

  /** Make the activity and present its card. Null when nothing could be made. */
  async present(input: {
    threadId: string;
    tenantId: string | null;
    trackId: string;
    kind: SideQuestKind;
    focusItemId: string | null;
    framing: string | null;
    spine: CourseSpine;
    languageCode: string;
    difficulty: SideQuestDifficulty;
    bundle: GuideReleaseBundle;
    tier?: GuideBudgetTier;
    attribution: GuideCallAttribution;
    onCost?: (usd: number) => void;
    emitDurable: (
      type: string,
      data: Record<string, unknown>,
    ) => Promise<number>;
  }): Promise<GuideCardEvent | null> {
    const spec = await this.make(input);
    if (!spec) return null;
    const title = spec.activity.title;
    const saved = await this.cards.save(
      this.cards.create({
        threadId: input.threadId,
        kind: GuideCardKind.MICRO_ACTIVITY,
        presentation: GuideCardPresentation.INLINE,
        state: GuideCardState.READY,
        title: title.slice(0, 255),
        trackItemId: input.focusItemId,
        payload: { spec, kind: input.kind },
        tenantId: input.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.MICRO_ACTIVITY,
      presentation: GuideCardPresentation.INLINE,
      state: GuideCardState.READY,
      title,
      framing: input.framing,
      meta: { format: 'practice' },
      cta: { label: 'Try it', action: 'open' },
      payload: { activity: learnerSafeActivity(spec) },
    };
    const seq = await input.emitDurable('card.presented', { card });
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...(saved.payload ?? {}), card } as Record<string, any>,
    });
    return card;
  }

  private async make(input: {
    kind: SideQuestKind;
    trackId: string;
    focusItemId: string | null;
    spine: CourseSpine;
    languageCode: string;
    difficulty: SideQuestDifficulty;
    bundle: GuideReleaseBundle;
    tier?: GuideBudgetTier;
    attribution: GuideCallAttribution;
    onCost?: (usd: number) => void;
  }): Promise<SideQuestSpec | null> {
    const focusIds = input.focusItemId ? [input.focusItemId] : [];
    if (ASSESSOR_KINDS.has(input.kind)) {
      const activity = await this.assessor.generate({
        kind: input.kind as AssessorKind,
        trackId: input.trackId,
        spine: input.spine,
        languageCode: input.languageCode,
        focusItemIds: focusIds,
        difficulty: input.difficulty,
        bundle: input.bundle,
        tier: input.tier,
        attribution: input.attribution,
        onCost: input.onCost,
      });
      return activity ? { source: 'assessor', activity } : null;
    }
    // A rehearsal is about the practice conversation ahead; the others
    // about what was just done.
    const focusItem =
      input.spine.items.find((item) => item.id === input.focusItemId) ??
      (input.kind === 'rehearse_line'
        ? input.spine.current
        : [...input.spine.items]
            .reverse()
            .find((item) => item.state === 'completed')) ??
      null;
    const focus = focusItem
      ? {
          itemId: focusItem.id,
          title: focusItem.title,
          type: itemTypeLabel(focusItem.type),
          text: await this.content.focusText(
            input.trackId,
            input.spine,
            input.languageCode,
            focusItem.id,
          ),
        }
      : null;
    const activity = await this.coach.prompt({
      kind: input.kind as CoachKind,
      languageCode: input.languageCode,
      focus,
      bundle: input.bundle,
      tier: input.tier,
      attribution: input.attribution,
      onCost: input.onCost,
    });
    return activity ? { source: 'coach', activity } : null;
  }

  /**
   * The learner's answer: marked against the key (Assessor) or given one
   * note (Coach). The card is then done, the pacing counts it toward the
   * hidden difficulty, and Ally hears about it on the next turn.
   */
  async respond(input: {
    thread: GuideThread;
    cardId: string;
    answers?: Array<{ questionId: string; optionId: string }>;
    text?: string;
    languageCode: string;
    bundle: GuideReleaseBundle;
    attribution: GuideCallAttribution;
  }): Promise<SideQuestResult> {
    const card = await this.cards.findOne({
      where: { id: input.cardId, threadId: input.thread.id },
    });
    if (!card || card.kind !== GuideCardKind.MICRO_ACTIVITY) {
      throw new NotFoundException('Practice not found');
    }
    if (card.state === GuideCardState.DONE) {
      throw new BadRequestException('This practice is already done.');
    }
    const spec = card.payload?.spec as SideQuestSpec | undefined;
    if (!spec) throw new NotFoundException('Practice not found');
    const kind = (card.payload?.kind ?? spec.activity.kind) as SideQuestKind;

    let result: SideQuestResult;
    let description: string;
    let correct = 0;
    let answered = 0;
    if (spec.source === 'assessor') {
      if (!input.answers?.length) {
        throw new BadRequestException('Choose an answer first.');
      }
      const results = gradeAssessorActivity(spec.activity, input.answers);
      correct = results.filter((r) => r.correct).length;
      answered = results.length;
      result = { cardId: card.id, kind, results };
      description =
        `The learner did the practice "${spec.activity.title}" (${kind.replace('_', ' ')}): ` +
        `${correct} of ${answered} as the course would answer.` +
        ' Recognise the effort if it fits; never make it a score.';
    } else {
      const text = (input.text ?? '').trim();
      if (!text) throw new BadRequestException('Write something first.');
      if (text.length > 2_000) {
        throw new BadRequestException('Keep it under 2,000 characters.');
      }
      const note = await this.coach.note({
        activity: spec.activity,
        answer: text,
        languageCode: input.languageCode,
        bundle: input.bundle,
        attribution: input.attribution,
      });
      result = { cardId: card.id, kind, note };
      description =
        `The learner did the practice "${spec.activity.title}" (${kind.replace('_', ' ')}). ` +
        'They have seen the Coach’s note on it; do not repeat it.';
    }

    await this.cards.update(card.id, {
      state: GuideCardState.DONE,
      payload: {
        ...(card.payload ?? {}),
        card: { ...(card.payload?.card ?? {}), state: GuideCardState.DONE },
        response: input.answers ?? { text: (input.text ?? '').slice(0, 2_000) },
        result,
      } as Record<string, any>,
    });
    await this.bus.appendDurable(input.thread.id, 'card.updated', {
      cardId: card.id,
      state: GuideCardState.DONE,
    });
    const pacing: GuideThreadPacing = { ...(input.thread.pacing ?? {}) };
    const sideQuest = { ...(pacing.sideQuest ?? {}) };
    if (answered) {
      sideQuest.answered = (sideQuest.answered ?? 0) + answered;
      sideQuest.correct = (sideQuest.correct ?? 0) + correct;
    }
    await this.threads.saveState(input.thread.id, {
      pacing: { ...pacing, sideQuest },
    });
    await this.threads.queueTrigger(input.thread, {
      kind: 'side_quest_done',
      dedupeKey: `side_quest_done:${card.id}`,
      description,
    });
    return result;
  }
}
