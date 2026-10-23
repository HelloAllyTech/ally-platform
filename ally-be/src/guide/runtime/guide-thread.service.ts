import { Injectable, NotFoundException } from '@nestjs/common';
import { Between, DataSource, LessThan } from 'typeorm';
import { TokenUser } from 'src/auth/type/auth.types';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { AgentChannel } from 'src/llm-agent/harness/enum/harness.enum';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideMessage } from '../entity/guide-message.entity';
import {
  GuideMessageKind,
  GuideMessageRole,
  GuideThreadStatus,
} from '../enum/guide.enum';
import { GuideSettingsService } from '../settings/guide-settings.service';
import { guideDisabled, guideNoAccess } from '../guide-errors';

const PG_UNIQUE_VIOLATION = '23505';

function returningRows<T>(result: unknown): T[] {
  const value = result as unknown[];
  return (Array.isArray(value?.[0]) ? value[0] : value) as T[];
}

export interface AppendMessageInput {
  /** Pre-assigned, when deltas already named the message while it streamed. */
  id?: string;
  role: GuideMessageRole;
  kind?: GuideMessageKind;
  channel?: AgentChannel;
  content: string | null;
  turnId?: string | null;
  clientTurnId?: string | null;
  renderedContent?: Record<string, any>[] | null;
  providerBlocks?: Record<string, any>[] | null;
  toolCalls?: Record<string, any>[] | null;
  metadata?: Record<string, any> | null;
  flags?: GuideMessage['flags'];
}

/**
 * Threads and their transcripts (plans/ally-guide/plan.md §8.1). A thread is
 * private to the learner who owns it, in the org it was created under: any
 * other caller gets the same 404 as a missing thread, so ids cannot be probed.
 */
/**
 * The newest unfinished course-item card for ($1 thread, $2 item) created
 * since $3 (an ISO instant, or null for any time). `createdAt` is a
 * timestamp without time zone holding UTC, so the instant is converted in
 * SQL — a JS Date parameter would be read in the server process's zone.
 */
export const LIVE_ITEM_CARD_SQL = `SELECT "id", "state" FROM "guide_cards"
  WHERE "threadId" = $1 AND "trackItemId" = $2 AND "kind" = 'course_item'
    AND "state" IN ('announced', 'ready', 'active')
    AND ($3::timestamptz IS NULL OR "createdAt" >= ($3::timestamptz AT TIME ZONE 'UTC'))
  ORDER BY "createdAt" DESC LIMIT 1`;

@Injectable()
export class GuideThreadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: GuideSettingsService,
    private readonly trackEnrollmentService: TrackEnrollmentService,
  ) {}

  private get threads() {
    return this.dataSource.getRepository(GuideThread);
  }

  /**
   * The learner's active thread for this course, created on first visit.
   * Checks the kill switches and the same access rules as the classic course
   * (an enrolled learner keeps access; anyone else needs the course assigned
   * to their org and group).
   */
  /** The guide is on for this learner's course and they may open it. */
  async assertCanOpen(trackId: string, user: TokenUser): Promise<void> {
    if (!(await this.settings.isGuidedAvailable(trackId, user.tenantId))) {
      throw guideDisabled();
    }
    const access = await this.trackEnrollmentService.getTrackAccess(trackId);
    if (!access.hasAccess) {
      throw guideNoAccess();
    }
  }

  async getOrCreateForUser(
    trackId: string,
    user: TokenUser,
  ): Promise<GuideThread> {
    await this.assertCanOpen(trackId, user);
    const existing = await this.findActive(trackId, user);
    if (existing) return existing;
    try {
      return await this.threads.save(
        this.threads.create({
          userId: user.id,
          tenantId: user.tenantId,
          trackId,
          status: GuideThreadStatus.ACTIVE,
        }),
      );
    } catch (error) {
      // Two tabs opening the course at once: the loser reads the winner's row.
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        const winner = await this.findActive(trackId, user);
        if (winner) return winner;
      }
      throw error;
    }
  }

  /** The learner's active thread for a course, if they have one. */
  findActiveForUser(
    trackId: string,
    user: Pick<TokenUser, 'id' | 'tenantId'>,
  ): Promise<GuideThread | null> {
    return this.findActive(trackId, user);
  }

  /**
   * Leave a platform event for the thread's next turn (the trigger inbox,
   * plan §7.8). False when this event was already queued for this thread.
   */
  async queueTrigger(
    thread: Pick<GuideThread, 'id' | 'tenantId'>,
    input: {
      kind: string;
      dedupeKey: string;
      description: string;
      extra?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const rows = returningRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO "guide_triggers"
           ("threadId", "kind", "dedupeKey", "payload", "status", "tenant_id")
         VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
         ON CONFLICT ("dedupeKey") DO NOTHING
         RETURNING "id"`,
        [
          thread.id,
          input.kind,
          `${thread.id}:${input.dedupeKey}`,
          JSON.stringify({ description: input.description, ...input.extra }),
          thread.tenantId ?? null,
        ],
      ),
    );
    return rows.length > 0;
  }

  private findActive(
    trackId: string,
    user: Pick<TokenUser, 'id' | 'tenantId'>,
  ): Promise<GuideThread | null> {
    return this.threads.findOne({
      where: {
        trackId,
        userId: user.id,
        tenantId: user.tenantId,
        status: GuideThreadStatus.ACTIVE,
      },
    });
  }

  async getOwned(threadId: string, user: TokenUser): Promise<GuideThread> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (
      !thread ||
      thread.userId !== user.id ||
      thread.tenantId !== user.tenantId
    ) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }

  /** Append one message with the next per-thread seq, atomically. */
  async appendMessage(
    threadId: string,
    tenantId: string | null | undefined,
    input: AppendMessageInput,
  ): Promise<GuideMessage> {
    return this.dataSource.transaction(async (manager) => {
      const rows = returningRows<{ lastMessageSeq: number }>(
        await manager.query(
          `UPDATE "guide_threads"
              SET "lastMessageSeq" = "lastMessageSeq" + 1, "updatedAt" = now()
            WHERE "id" = $1 RETURNING "lastMessageSeq"`,
          [threadId],
        ),
      );
      if (!rows.length) throw new NotFoundException('Thread not found');
      const repo = manager.getRepository(GuideMessage);
      return repo.save(
        repo.create({
          ...(input.id ? { id: input.id } : {}),
          threadId,
          seq: rows[0].lastMessageSeq,
          role: input.role,
          kind: input.kind ?? GuideMessageKind.CHAT,
          channel: input.channel ?? AgentChannel.TEXT,
          content: input.content,
          turnId: input.turnId ?? null,
          clientTurnId: input.clientTurnId ?? null,
          renderedContent: input.renderedContent ?? null,
          providerBlocks: input.providerBlocks ?? null,
          toolCalls: input.toolCalls ?? null,
          metadata: input.metadata ?? null,
          flags: input.flags ?? null,
          tenantId: tenantId ?? null,
        }),
      );
    });
  }

  /**
   * Record what the model saw for a learner message, once. Written at the end
   * of a successful turn — the request it ran with is only final then — and
   * never changed after, because history is replayed byte for byte.
   */
  async setRenderedContent(
    messageId: string,
    rendered: Record<string, any>[],
    flags?: GuideMessage['flags'],
  ): Promise<void> {
    await this.dataSource
      .getRepository(GuideMessage)
      .createQueryBuilder()
      .update()
      .set({ renderedContent: rendered, ...(flags ? { flags } : {}) })
      .where('id = :id AND "renderedContent" IS NULL', { id: messageId })
      .execute();
  }

  /** Rows the model's history is replayed from: [fromSeq, beforeSeq). */
  historyRows(
    threadId: string,
    fromSeq: number,
    beforeSeq: number,
  ): Promise<GuideMessage[]> {
    return this.dataSource.getRepository(GuideMessage).find({
      where: { threadId, seq: Between(fromSeq, beforeSeq - 1) },
      order: { seq: 'ASC' },
    });
  }

  /** The last `limit` rows before `beforeSeq`, oldest first. */
  async recentRows(
    threadId: string,
    beforeSeq: number,
    limit: number,
  ): Promise<GuideMessage[]> {
    const rows = await this.dataSource.getRepository(GuideMessage).find({
      where: { threadId, seq: LessThan(beforeSeq) },
      order: { seq: 'DESC' },
      take: limit,
    });
    return rows.reverse();
  }

  /** Persist the turn's changes to the thread's mode, pacing and epoch. */
  async saveState(
    threadId: string,
    patch: Partial<
      Pick<
        GuideThread,
        | 'mode'
        | 'modeChangedAt'
        | 'pacing'
        | 'epoch'
        | 'epochSnapshot'
        | 'releaseId'
        | 'languageCode'
      >
    >,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.threads.update(threadId, patch as never);
  }

  /**
   * Record that the learner spoke over a voice reply after `spokenChars`
   * characters. The stored reply keeps what the model said (history stays
   * replayable); the marker tells the next turn what was actually heard.
   * Returns what they heard, or null when there is no such reply.
   */
  async markReplyInterrupted(
    threadId: string,
    turnId: string,
    spokenChars: number,
  ): Promise<string | null> {
    const repo = this.dataSource.getRepository(GuideMessage);
    const reply = await repo.findOne({
      where: { threadId, turnId, role: GuideMessageRole.ALLY },
    });
    if (!reply?.content) return null;
    const heard = reply.content.slice(0, Math.max(0, spokenChars)).trim();
    await repo.update(reply.id, {
      metadata: {
        ...(reply.metadata ?? {}),
        interrupted: true,
        spokenChars,
      } as Record<string, any>,
    });
    return heard;
  }

  /** The course item open on the learner's screen right now, if any. */
  async openItemCard(
    threadId: string,
  ): Promise<{ trackItemId: string } | null> {
    const rows: Array<{ trackItemId: string }> = await this.dataSource.query(
      `SELECT "trackItemId" FROM "guide_cards"
        WHERE "threadId" = $1 AND "state" = 'active' AND "kind" = 'course_item'
          AND "trackItemId" IS NOT NULL
        ORDER BY "updatedAt" DESC LIMIT 1`,
      [threadId],
    );
    return rows[0] ?? null;
  }

  /**
   * An unfinished card for this item presented since the epoch began, or
   * null. Presenting the same step again only stacks duplicate cards in the
   * feed; within an epoch the earlier one is still in view.
   */
  async liveItemCard(
    threadId: string,
    trackItemId: string,
    epochStartedAt: string | null,
  ): Promise<{ id: string; state: string } | null> {
    const rows: Array<{ id: string; state: string }> =
      await this.dataSource.query(LIVE_ITEM_CARD_SQL, [
        threadId,
        trackItemId,
        epochStartedAt,
      ]);
    return rows[0] ?? null;
  }

  async touchLearnerActivity(threadId: string): Promise<void> {
    await this.threads.update(threadId, { lastLearnerActivityAt: new Date() });
  }

  /** A page of the transcript, newest last, for a reload or a scroll back. */
  async listMessages(
    threadId: string,
    beforeSeq?: number,
    limit = 50,
  ): Promise<GuideMessage[]> {
    const qb = this.dataSource
      .getRepository(GuideMessage)
      .createQueryBuilder('m')
      .where('m.threadId = :threadId', { threadId });
    if (beforeSeq) qb.andWhere('m.seq < :beforeSeq', { beforeSeq });
    const page = await qb.orderBy('m.seq', 'DESC').limit(limit).getMany();
    return page.reverse();
  }
}
