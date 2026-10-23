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
  async getOrCreateForUser(
    trackId: string,
    user: TokenUser,
  ): Promise<GuideThread> {
    if (!(await this.settings.isGuidedAvailable(trackId, user.tenantId))) {
      throw guideDisabled();
    }
    const access = await this.trackEnrollmentService.getTrackAccess(trackId);
    if (!access.hasAccess) {
      throw guideNoAccess();
    }
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

  private findActive(
    trackId: string,
    user: TokenUser,
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
