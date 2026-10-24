import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RedisService } from 'src/redis/service/redis.service';
import { afterItemOpened } from '../conductor/pacing';
import { GuideCardEventRequest } from '../contract/generated/guide-contract';
import { GuideCard } from '../entity/guide-card.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideCardKind, GuideCardState } from '../enum/guide.enum';
import { GuideEventBusService } from './guide-event-bus.service';
import { GuideThreadService } from './guide-thread.service';

/** Seconds a learner counts as present after the last heartbeat (plan §7.8). */
export const GUIDE_PRESENCE_TTL_SECONDS = 45;
export const guidePresenceKey = (threadId: string) =>
  `guide:presence:${threadId}`;

/**
 * What the learner did with a card (plans/ally-guide/plan.md §9.1 card
 * events). Card state is the client's to report but not to decide: a
 * completion claim is accepted only when classic progression already says
 * the item is complete — the guide never completes anything itself.
 */
@Injectable()
export class GuideCardService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly threads: GuideThreadService,
    private readonly bus: GuideEventBusService,
    private readonly redis: RedisService,
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
  ) {}

  async handle(
    thread: GuideThread,
    cardId: string,
    request: GuideCardEventRequest,
  ): Promise<{ cardId: string; state: GuideCardState; verified?: boolean }> {
    const card = await this.cards.findOne({
      where: { id: cardId, threadId: thread.id },
    });
    if (!card) throw new NotFoundException('Card not found');

    let next = card.state as GuideCardState;
    let verified: boolean | undefined;
    switch (request.type) {
      case 'opened':
      case 'launched':
      case 'reopened':
        next = GuideCardState.ACTIVE;
        if (card.kind === GuideCardKind.COURSE_ITEM) {
          // Opening an item is progress: the off-course count starts again.
          await this.threads.saveState(thread.id, {
            pacing: afterItemOpened(thread.pacing ?? {}, new Date()),
          });
        }
        break;
      case 'closed':
      case 'returned':
        next = card.verifiedAt ? GuideCardState.DONE : GuideCardState.READY;
        break;
      case 'dismissed':
        next = GuideCardState.DISMISSED;
        break;
      case 'completed_claim':
        verified = await this.isCompleted(thread, card.trackItemId ?? null);
        if (verified) next = GuideCardState.DONE;
        break;
    }

    if (next !== card.state || verified) {
      await this.cards.update(card.id, {
        state: next,
        ...(verified && !card.verifiedAt ? { verifiedAt: new Date() } : {}),
      });
      await this.bus.appendDurable(thread.id, 'card.updated', {
        cardId: card.id,
        state: next,
      });
    }
    return {
      cardId: card.id,
      state: next,
      ...(verified !== undefined ? { verified } : {}),
    };
  }

  /** Classic progression's word on whether the learner completed the item. */
  private async isCompleted(
    thread: GuideThread,
    trackItemId: string | null,
  ): Promise<boolean> {
    if (!trackItemId || !thread.userId) return false;
    const rows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT tip."status" AS status
         FROM "track_item_progress" tip
         JOIN "track_enrollments" te ON te."id" = tip."trackEnrollmentId"
        WHERE te."trackId" = $1 AND te."userId" = $2
          AND tip."trackItemId" = $3 AND tip."deletedAt" IS NULL
        LIMIT 1`,
      [thread.trackId, thread.userId, trackItemId],
    );
    return rows[0]?.status === 'COMPLETED';
  }

  /** The SSE stream marks the learner present while it is open. */
  async markPresent(threadId: string): Promise<void> {
    await this.redis
      .set(guidePresenceKey(threadId), '1', GUIDE_PRESENCE_TTL_SECONDS)
      .catch(() => undefined);
  }

  async markAbsent(threadId: string): Promise<void> {
    await this.redis.del(guidePresenceKey(threadId)).catch(() => undefined);
  }

  async isPresent(threadId: string): Promise<boolean> {
    return Boolean(
      await this.redis.get(guidePresenceKey(threadId)).catch(() => null),
    );
  }
}
