import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import {
  SCENARIO_SESSION_DEBRIEF_READY_EVENT,
  ScenarioSessionDebriefReadyEvent,
} from 'src/learn/constants/scenario-session-events.constants';
import {
  TRACK_EVENTS,
  TrackQuizGradedEvent,
  TrackRoleplayAttemptEndedEvent,
} from 'src/track/service/track-progress.service';
import { CourseSpine } from '../conductor/course-spine';
import { GuideConductorService } from '../conductor/guide-conductor.service';
import {
  afterItemCompleted,
  atmosphereOf,
  celebrationFor,
  releaseWindowOpen,
} from '../conductor/pacing';
import { itemTypeLabel } from '../context/guide-context';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideCardKind,
  GuideCardState,
  GuideMode,
  GuideThreadStatus,
  GuideTriggerStatus,
} from '../enum/guide.enum';
import { GUIDE_DEFAULT_POLICY } from '../release/guide-release.bundle';
import { GuideCardService } from './guide-card.service';
import { GuideEventBusService } from './guide-event-bus.service';
import { GuideThreadService } from './guide-thread.service';
import { GuideTurnService } from './guide-turn.service';

/** The payload TrackProgressService emits (after commit). */
export interface TrackProgressEventPayload {
  userId: number;
  tenantId: string;
  trackId: string;
  trackEnrollmentId: string;
  trackItemId: string;
  trackSectionId: string;
  itemType: string;
}

function returningRows<T>(result: unknown): T[] {
  const value = result as unknown[];
  return (Array.isArray(value?.[0]) ? value[0] : value) as T[];
}

/**
 * Folds course progress into the learner's guide thread (plans/ally-guide/
 * plan.md §7.8 platform events, §11 C-9). One path for every completion —
 * in the guided view, in classic or in the app — because the event comes
 * from progression itself, after its transaction commits:
 *
 *  - the item's card becomes done, the Spine moves, a practice item or a
 *    chapter earns its milestone (celebration capped by tone);
 *  - pacing records the completion (a high-tension item opens the quiet
 *    release window; the first one is the learner's first win);
 *  - a trigger row carries the event into the next turn, so Ally can notice
 *    it; if the learner is watching, a turn runs for it now.
 *
 * At-least-once safe: every effect hangs off a trigger row whose dedupe key
 * is unique, and a duplicate event stops at the insert.
 */
@Injectable()
export class GuideProgressListener {
  private readonly logger = LoggerService.getInstance(
    GuideProgressListener.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly threadService: GuideThreadService,
    private readonly bus: GuideEventBusService,
    private readonly conductor: GuideConductorService,
    private readonly cards: GuideCardService,
    private readonly turns: GuideTurnService,
    @InjectRepository(GuideThread)
    private readonly threads: Repository<GuideThread>,
  ) {}

  @OnEvent(TRACK_EVENTS.ITEM_COMPLETED, { async: true })
  async onItemCompleted(event: TrackProgressEventPayload): Promise<void> {
    await this.safely('item', event, () => this.itemCompleted(event));
  }

  @OnEvent(TRACK_EVENTS.SECTION_COMPLETED, { async: true })
  async onSectionCompleted(event: TrackProgressEventPayload): Promise<void> {
    await this.safely('section', event, () =>
      this.milestone(event, 'section_complete'),
    );
  }

  @OnEvent(TRACK_EVENTS.TRACK_COMPLETED, { async: true })
  async onTrackCompleted(event: TrackProgressEventPayload): Promise<void> {
    await this.safely('track', event, () =>
      this.milestone(event, 'course_complete'),
    );
  }

  @OnEvent(TRACK_EVENTS.QUIZ_GRADED, { async: true })
  async onQuizGraded(event: TrackQuizGradedEvent): Promise<void> {
    await this.safely('quiz', event as never, () => this.quizGraded(event));
  }

  @OnEvent(TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED, { async: true })
  async onRoleplayEnded(event: TrackRoleplayAttemptEndedEvent): Promise<void> {
    await this.safely('roleplay', event as never, () =>
      this.roleplayEnded(event),
    );
  }

  @OnEvent(SCENARIO_SESSION_DEBRIEF_READY_EVENT, { async: true })
  async onDebriefReady(event: ScenarioSessionDebriefReadyEvent): Promise<void> {
    await this.safely('debrief', event as never, () =>
      this.debriefReady(event),
    );
  }

  private async safely(
    what: string,
    event: TrackProgressEventPayload,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Guide ${what} event handling failed for track ${event?.trackId ?? '?'}`,
        error,
      );
    }
  }

  private activeThreads(event: TrackProgressEventPayload) {
    return this.threads.find({
      where: {
        userId: event.userId,
        trackId: event.trackId,
        tenantId: event.tenantId,
        status: GuideThreadStatus.ACTIVE,
      },
    });
  }

  /** Insert the trigger; false when this event was already handled. */
  private async claim(
    thread: GuideThread,
    kind: string,
    dedupeKey: string,
    description: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    const rows = returningRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO "guide_triggers"
           ("threadId", "kind", "dedupeKey", "payload", "status", "tenant_id")
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT ("dedupeKey") DO NOTHING
         RETURNING "id"`,
        [
          thread.id,
          kind,
          dedupeKey,
          JSON.stringify({ description, ...extra }),
          GuideTriggerStatus.PENDING,
          thread.tenantId ?? null,
        ],
      ),
    );
    return rows.length > 0;
  }

  /** The course as this learner sees it, read inside their context. */
  private loadSpine(event: TrackProgressEventPayload): Promise<CourseSpine> {
    return ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(String(event.userId), event.tenantId);
        return (await this.conductor.loadCourse(event.trackId)).spine;
      },
      { path: 'guide-progress' },
    );
  }

  private async itemCompleted(event: TrackProgressEventPayload): Promise<void> {
    const threads = await this.activeThreads(event);
    if (!threads.length) return;
    const spine = await this.loadSpine(event);
    const item = spine.items.find(
      (candidate) => candidate.id === event.trackItemId,
    );
    const title = item?.title ?? 'an activity';
    const description =
      `The learner completed "${title}"` +
      (item ? ` (${itemTypeLabel(item.type)})` : '') +
      '.';

    for (const thread of threads) {
      const dedupeKey = `item_completed:${event.trackEnrollmentId}:${event.trackItemId}`;
      if (
        !(await this.claim(thread, 'item_completed', dedupeKey, description, {
          itemId: event.trackItemId,
        }))
      ) {
        continue;
      }

      // The item's cards are done, whichever view the learner finished it in.
      const updated = returningRows<{ id: string }>(
        await this.dataSource.query(
          `UPDATE "guide_cards"
              SET "state" = $1, "verifiedAt" = COALESCE("verifiedAt", now()), "updatedAt" = now()
            WHERE "threadId" = $2 AND "trackItemId" = $3 AND "kind" = $4
              AND "state" NOT IN ($1, $5)
          RETURNING "id"`,
          [
            GuideCardState.DONE,
            thread.id,
            event.trackItemId,
            GuideCardKind.COURSE_ITEM,
            GuideCardState.DISMISSED,
          ],
        ),
      );
      for (const card of updated) {
        await this.bus.appendDurable(thread.id, 'card.updated', {
          cardId: card.id,
          state: GuideCardState.DONE,
        });
      }

      const pacing = item
        ? afterItemCompleted(thread.pacing ?? {}, item, new Date())
        : (thread.pacing ?? {});
      await this.threadService.saveState(thread.id, { pacing });

      await this.bus.appendDurable(thread.id, 'spine.updated', {
        currentItemId: spine.current?.id ?? null,
        completedItems: spine.completed,
        totalItems: spine.total,
      });

      if (item?.boss) {
        const mode = thread.mode ?? GuideMode.NORMAL;
        const atmosphere = atmosphereOf({
          mode,
          releaseWindowOpen: releaseWindowOpen(
            pacing,
            GUIDE_DEFAULT_POLICY.releaseWindowMaxTurns,
          ),
          spine,
        });
        const tone = celebrationFor({
          mode,
          atmosphere,
          item,
          courseFinished: false,
        });
        if (tone !== 'none') {
          await this.bus.appendDurable(thread.id, 'milestone', {
            kind: 'boss_complete',
            tone,
            label: `Finished ${title}`,
          });
        }
      }

      // Ally notices it now if the learner is watching; otherwise it waits
      // for their next message.
      if (thread.userId && (await this.cards.isPresent(thread.id))) {
        await this.turns.acceptTrigger(
          { ...thread, pacing },
          { id: thread.userId, tenantId: thread.tenantId ?? event.tenantId },
          { dedupeKey, description },
        );
      }
    }
  }

  private async milestone(
    event: TrackProgressEventPayload,
    kind: 'section_complete' | 'course_complete',
  ): Promise<void> {
    const threads = await this.activeThreads(event);
    if (!threads.length) return;
    const spine = await this.loadSpine(event);
    const section = spine.sections.find((s) => s.id === event.trackSectionId);
    const label =
      kind === 'course_complete'
        ? `Finished the course`
        : `Finished ${section?.title ? `"${section.title}"` : 'a chapter'}`;
    const description =
      kind === 'course_complete'
        ? 'The learner has finished the whole course.'
        : `The learner finished the chapter "${section?.title ?? ''}".`;

    for (const thread of threads) {
      const dedupeKey =
        kind === 'course_complete'
          ? `course_completed:${event.trackEnrollmentId}`
          : `section_completed:${event.trackEnrollmentId}:${event.trackSectionId}`;
      if (!(await this.claim(thread, kind, dedupeKey, description))) continue;
      const mode = thread.mode ?? GuideMode.NORMAL;
      const atmosphere = atmosphereOf({
        mode,
        releaseWindowOpen: releaseWindowOpen(
          thread.pacing ?? {},
          GUIDE_DEFAULT_POLICY.releaseWindowMaxTurns,
        ),
        spine,
      });
      const tone = celebrationFor({
        mode,
        atmosphere,
        item: { boss: false, triggerWarnings: [], tension: 'medium' },
        courseFinished: kind === 'course_complete',
      });
      if (tone !== 'none') {
        await this.bus.appendDurable(thread.id, 'milestone', {
          kind,
          tone,
          label,
        });
      }
      if (kind === 'course_complete') {
        // The thread stays open after the course (plan D3).
        await this.threads.update(thread.id, { completedAt: new Date() });
      }
    }
  }

  /** The course and owner behind an enrollment. */
  private async enrollment(
    trackEnrollmentId: string,
  ): Promise<{ trackId: string; tenantId: string; userId: number } | null> {
    const rows: Array<{ trackId: string; tenantId: string; userId: number }> =
      await this.dataSource.query(
        `SELECT "trackId", "tenant_id" AS "tenantId", "userId"
           FROM "track_enrollments" WHERE "id" = $1`,
        [trackEnrollmentId],
      );
    return rows[0] ?? null;
  }

  /**
   * Leave a platform event for each of the learner's guide threads on this
   * course; if `speakNow` and they are watching, Ally takes a turn for it.
   */
  private async fold(input: {
    trackEnrollmentId: string;
    trackItemId: string;
    kind: string;
    dedupeKey: string;
    describe: (title: string, typeLabel: string) => string;
    speakNow: boolean;
  }): Promise<void> {
    const enrollment = await this.enrollment(input.trackEnrollmentId);
    if (!enrollment) return;
    const base = {
      userId: enrollment.userId,
      tenantId: enrollment.tenantId,
      trackId: enrollment.trackId,
      trackEnrollmentId: input.trackEnrollmentId,
      trackItemId: input.trackItemId,
      trackSectionId: '',
      itemType: '',
    };
    const threads = await this.activeThreads(base);
    if (!threads.length) return;
    const spine = await this.loadSpine(base);
    const item = spine.items.find(
      (candidate) => candidate.id === input.trackItemId,
    );
    const description = input.describe(
      item?.title ?? 'an activity',
      item ? itemTypeLabel(item.type) : 'activity',
    );
    for (const thread of threads) {
      if (
        !(await this.claim(thread, input.kind, input.dedupeKey, description, {
          itemId: input.trackItemId,
        }))
      ) {
        continue;
      }
      if (
        input.speakNow &&
        thread.userId &&
        (await this.cards.isPresent(thread.id))
      ) {
        await this.turns.acceptTrigger(
          thread,
          {
            id: thread.userId,
            tenantId: thread.tenantId ?? enrollment.tenantId,
          },
          { dedupeKey: input.dedupeKey, description },
        );
      }
    }
  }

  private async quizGraded(event: TrackQuizGradedEvent): Promise<void> {
    const left =
      event.maxAttempts != null
        ? Math.max(0, event.maxAttempts - event.attemptsUsed)
        : null;
    const score =
      event.scorePct != null ? ` (${Math.round(event.scorePct)}%)` : '';
    await this.fold({
      trackEnrollmentId: event.trackEnrollmentId,
      trackItemId: event.trackItemId,
      kind: 'quiz_graded',
      dedupeKey: `quiz_graded:${event.attemptId}:${event.status}`,
      // A pass is also an item completion, which speaks for itself.
      speakNow: event.passed !== true,
      describe: (title) => {
        if (event.status === 'PENDING_GRADING') {
          return `The learner's answers to the quiz "${title}" are still being graded.`;
        }
        if (event.passed)
          return `The learner passed the quiz "${title}"${score}.`;
        if (left === 0) {
          return (
            `The learner did not pass the quiz "${title}"${score} and has no attempts left. ` +
            'The course keeps it locked, as in the classic view: be kind, offer to revisit the ' +
            'material, and point them to the course owner or support.'
          );
        }
        return (
          `The learner did not pass the quiz "${title}" this time${score}` +
          (left != null
            ? `; ${left} attempt${left === 1 ? '' : 's'} left.`
            : '.') +
          ' Reflect on it with consequences, not correctness, within what the quiz lets them see, ' +
          'and offer to revisit the material first.'
        );
      },
    });
  }

  private async roleplayEnded(
    event: TrackRoleplayAttemptEndedEvent,
  ): Promise<void> {
    await this.fold({
      trackEnrollmentId: event.trackEnrollmentId,
      trackItemId: event.trackItemId,
      kind: 'roleplay_ended',
      dedupeKey: `roleplay_ended:${event.trackItemProgressId}:${event.callDurationMs}:${event.score ?? 'na'}`,
      speakNow: event.outcome !== 'completed',
      describe: (title) => {
        switch (event.outcome) {
          case 'too_short':
            return (
              `The learner left the practice "${title}" early, so it does not count yet. ` +
              'Acknowledge it without judgement and offer to try again when they are ready, ' +
              'or to rehearse one opening line first.'
            );
          case 'below_score':
            return (
              `The learner finished the practice "${title}" but it did not meet the course's bar yet. ` +
              'Keep it about choices and their consequences; offer to try again when they are ready.'
            );
          default:
            return `The learner finished the practice "${title}".`;
        }
      },
    });
  }

  private async debriefReady(
    event: ScenarioSessionDebriefReadyEvent,
  ): Promise<void> {
    const rows: Array<{ trackItemProgressId: string | null }> =
      await this.dataSource.query(
        `SELECT "trackItemProgressId" FROM "scenario_sessions" WHERE "id" = $1`,
        [event.scenarioSessionId],
      );
    const progressId = rows[0]?.trackItemProgressId;
    if (!progressId) return;
    const progress: Array<{ trackEnrollmentId: string; trackItemId: string }> =
      await this.dataSource.query(
        `SELECT "trackEnrollmentId", "trackItemId" FROM "track_item_progress" WHERE "id" = $1`,
        [progressId],
      );
    if (!progress[0]) return;
    await this.fold({
      trackEnrollmentId: progress[0].trackEnrollmentId,
      trackItemId: progress[0].trackItemId,
      kind: 'debrief_ready',
      dedupeKey: `debrief_ready:${event.scenarioSessionId}`,
      speakNow: true,
      describe: (title) =>
        `The debrief for the learner's practice "${title}" is ready on their screen. ` +
        'Offer a short after-action review: ask what they noticed first, then what happened, ' +
        'why, and one thing to try next time. Never score the client.',
    });
  }
}
