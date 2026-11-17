import { Injectable } from '@nestjs/common';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThan,
  Repository,
} from 'typeorm';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentCardEvent } from '../entity/pm-agent-card-event.entity';
import { PmCardKind, PmCardStatus } from '../enum/pm-agent.enum';
import {
  PM_HISTORY_STATUSES,
  PM_NEEDS_YOU_STATUSES,
  PM_QUEUE_STATUSES,
} from '../constants/pm-agent.constants';

export interface PmCardTransition {
  cardId: string;
  /** The status(es) the card must be in for the move to happen. */
  from: PmCardStatus[];
  to: PmCardStatus;
  /** Extra columns written with the status. */
  patch?: Partial<PmAgentCard>;
  /** Extra conditions on the UPDATE (all must hold). */
  guard?: {
    /** `undoUntil > now()` — the undo window is still open. */
    undoOpen?: boolean;
    /** The card's `versionHash` equals this. */
    versionHash?: string;
    /** `decidedAt > now() - ms`. */
    decidedWithinMs?: number;
  };
  event: {
    type: string;
    actorUserId: number | null;
    detail?: Record<string, unknown> | null;
  };
  /** More writes in the SAME transaction, after the card moved (outbox, feedback…). */
  also?: (manager: EntityManager, card: PmAgentCard) => Promise<void>;
}

/**
 * Cards and their audit trail.
 *
 * Every status change goes through `transition`: one conditional UPDATE
 * (`… WHERE id = :id AND status IN (:from) [AND guards]`) plus the event row, in one
 * transaction. Zero rows updated means the card was not in a state that allows the move —
 * another admin decided first, the undo window closed, the version changed — and the
 * caller answers 409. Nothing is read-then-written, so two admins (or two ECS tasks)
 * racing on one card can never both win.
 */
@Injectable()
export class PmAgentCardRepository extends Repository<PmAgentCard> {
  constructor(private readonly dataSource: DataSource) {
    super(PmAgentCard, dataSource.createEntityManager());
  }

  async transition(params: PmCardTransition): Promise<PmAgentCard | null> {
    return this.dataSource.transaction(async (manager) => {
      const card = await this.conditionalUpdate(manager, params);
      if (!card) return null;
      await manager.getRepository(PmAgentCardEvent).insert({
        cardId: card.id,
        type: params.event.type,
        fromStatus: params.from.length === 1 ? params.from[0] : null,
        toStatus: params.to,
        cardVersion: card.version,
        actorUserId: params.event.actorUserId,
        detail: {
          ...(params.from.length > 1 ? { from: params.from } : {}),
          ...(params.event.detail ?? {}),
        } as never,
      });
      if (params.also) await params.also(manager, card);
      return card;
    });
  }

  /** Updates columns WITHOUT a status change, still conditional on status. */
  async patchIf(
    cardId: string,
    statuses: PmCardStatus[],
    patch: Partial<PmAgentCard>,
    event: PmCardTransition['event'],
    guard?: PmCardTransition['guard'],
  ): Promise<PmAgentCard | null> {
    return this.dataSource.transaction(async (manager) => {
      const card = await this.conditionalUpdate(manager, {
        cardId,
        from: statuses,
        to: undefined as unknown as PmCardStatus,
        patch,
        guard,
        event,
      });
      if (!card) return null;
      await manager.getRepository(PmAgentCardEvent).insert({
        cardId,
        type: event.type,
        fromStatus: card.status,
        toStatus: card.status,
        cardVersion: card.version,
        actorUserId: event.actorUserId,
        detail: (event.detail ?? null) as never,
      });
      return card;
    });
  }

  private async conditionalUpdate(
    manager: EntityManager,
    params: PmCardTransition,
  ): Promise<PmAgentCard | null> {
    const set: Record<string, unknown> = { ...(params.patch ?? {}) };
    if (params.to) set.status = params.to;
    const qb = manager
      .createQueryBuilder()
      .update(PmAgentCard)
      .set(set)
      .where('id = :id', { id: params.cardId })
      .andWhere('status IN (:...from)', { from: params.from });
    if (params.guard?.undoOpen) qb.andWhere('"undoUntil" > now()');
    if (params.guard?.versionHash) {
      qb.andWhere('"versionHash" = :versionHash', {
        versionHash: params.guard.versionHash,
      });
    }
    if (params.guard?.decidedWithinMs) {
      qb.andWhere(
        `"decidedAt" > now() - (:ms::int * interval '1 millisecond')`,
        { ms: params.guard.decidedWithinMs },
      );
    }
    const result = await qb.returning('*').execute();
    if (!result.affected) return null;
    const raw = (result.raw as Record<string, unknown>[])[0];
    return manager
      .getRepository(PmAgentCard)
      .create(raw as unknown as PmAgentCard);
  }

  /** Writes an event without touching the card (worker progress, notes). */
  async addEvent(
    card: Pick<PmAgentCard, 'id' | 'version' | 'status'>,
    type: string,
    actorUserId: number | null,
    detail?: Record<string, unknown> | null,
  ): Promise<void> {
    await this.manager.getRepository(PmAgentCardEvent).insert({
      cardId: card.id,
      type,
      fromStatus: card.status,
      toStatus: card.status,
      cardVersion: card.version,
      actorUserId,
      detail: (detail ?? null) as never,
    });
  }

  listEvents(cardId: string): Promise<PmAgentCardEvent[]> {
    return this.manager.getRepository(PmAgentCardEvent).find({
      where: { cardId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  countByStatus(statuses: PmCardStatus[]): Promise<number> {
    return this.count({ where: { status: In(statuses) } });
  }

  countOpen(): Promise<number> {
    return this.countByStatus(PM_QUEUE_STATUSES);
  }

  countNeedsYou(): Promise<number> {
    return this.count({
      where: {
        status: In(PM_NEEDS_YOU_STATUSES),
        needsYouDismissedAt: IsNull(),
      },
    });
  }

  /**
   * The review queue, in review order: needs-you items first, then questions, then
   * recommendations by rank. Ties fall back to age so the order never jitters.
   */
  listForReview(params: {
    statuses?: PmCardStatus[];
    kind?: PmCardKind;
    limit: number;
  }): Promise<PmAgentCard[]> {
    const needsYou = PM_NEEDS_YOU_STATUSES;
    const qb = this.createQueryBuilder('card');
    if (params.statuses?.length) {
      qb.where('card.status IN (:...statuses)', { statuses: params.statuses });
    } else {
      qb.where(
        new Brackets((w) => {
          w.where('card.status IN (:...queue)', {
            queue: PM_QUEUE_STATUSES,
          }).orWhere(
            'card.status IN (:...needsYou) AND card."needsYouDismissedAt" IS NULL',
            { needsYou },
          );
        }),
      );
    }
    if (params.kind) qb.andWhere('card.kind = :kind', { kind: params.kind });
    return qb
      .orderBy(
        `CASE WHEN card.status IN (:...needsYouOrder) AND card."needsYouDismissedAt" IS NULL THEN 0
              WHEN card.kind = 'question' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .setParameter('needsYouOrder', needsYou)
      .addOrderBy('card.rank', 'DESC')
      .addOrderBy('card.createdAt', 'ASC')
      .take(params.limit)
      .getMany();
  }

  listByStatuses(
    statuses: PmCardStatus[],
    limit: number,
    order: 'decidedAt' | 'updatedAt' = 'updatedAt',
  ): Promise<PmAgentCard[]> {
    return this.find({
      where: { status: In(statuses) },
      order: { [order]: 'DESC' },
      take: limit,
    });
  }

  listHistory(limit: number): Promise<PmAgentCard[]> {
    return this.listByStatuses(PM_HISTORY_STATUSES, limit, 'decidedAt');
  }

  /** A skipped question with this key is still suppressed. For the pipeline's gate. */
  async isQuestionSuppressed(questionKey: string): Promise<boolean> {
    const count = await this.count({
      where: {
        questionKey,
        status: PmCardStatus.SKIPPED,
        suppressUntil: MoreThan(new Date()),
      },
    });
    return count > 0;
  }

  /** Recommendation cards decided in a window, for the health metrics. */
  listDecidedSince(since: Date): Promise<PmAgentCard[]> {
    return this.createQueryBuilder('card')
      .where('card."decidedAt" >= :since', { since })
      .andWhere('card.kind = :kind', { kind: PmCardKind.RECOMMENDATION })
      .getMany();
  }

  /** Organisation names, for the public-repo scrubber. Read-only. */
  async listTenantNames(): Promise<string[]> {
    const rows: { name: string | null }[] = await this.dataSource.query(
      `SELECT DISTINCT name FROM tenants WHERE name IS NOT NULL`,
    );
    return rows.map((row) => String(row.name ?? '')).filter(Boolean);
  }
}
