import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { TRACK_EVENTS } from 'src/track/service/track-progress.service';
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

  private async safely(
    what: string,
    event: TrackProgressEventPayload,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Guide ${what}-completed handling failed for track ${event.trackId}`,
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
}
