import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { BuilderSessionKind } from 'src/builder/enum/builder.enum';
import { BuilderSessionRepository } from 'src/builder/repository/builder-session.repository';
import type { PlanRecord } from 'src/product-planning/type/plan-record.type';

/** A plan session with its `plan` record loaded (the column is `select: false`). */
export type PlanSession = BuilderSession & { plan: PlanRecord };

/**
 * Reads and writes plan sessions: Builder session rows with `kind = 'plan'`.
 *
 * Every read here is by id and returns rows regardless of visibility; callers
 * decide who may see them through PlanAccessService. Lists are scoped in their
 * own WHERE (the author, or shared plans only) — see the visibility reader
 * list in builder-session-visibility.spec.ts.
 */
@Injectable()
export class PlanSessionStore {
  constructor(
    private readonly sessions: BuilderSessionRepository,
    private readonly dataSource: DataSource,
  ) {}

  async find(sessionId: string): Promise<PlanSession | null> {
    const row = await this.sessions
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.id = :sessionId', { sessionId })
      .andWhere('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .getOne();
    if (!row) return null;
    return { ...row, plan: row.plan ?? {} } as PlanSession;
  }

  async get(sessionId: string): Promise<PlanSession> {
    const plan = await this.find(sessionId);
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /**
   * Shallow-merge `patch` into the plan record in one statement. Atomic per
   * call, so two writers patching different keys never lose each other's
   * write (a read-modify-write of the whole record would).
   */
  async patchPlan(
    sessionId: string,
    patch: Partial<PlanRecord>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || $2::jsonb,
              "updatedAt" = now()
        WHERE id = $1`,
      [sessionId, JSON.stringify(patch)],
    );
  }

  update(
    sessionId: string,
    columns: Partial<
      Pick<
        BuilderSession,
        | 'visibility'
        | 'leadUserId'
        | 'title'
        | 'archivedAt'
        | 'planStage'
        | 'planStageAt'
        | 'updatedBy'
      >
    >,
  ) {
    return this.sessions.update({ id: sessionId }, columns);
  }

  /** The repository, for the conditional updates the lead workflow needs. */
  get repository(): BuilderSessionRepository {
    return this.sessions;
  }
}
