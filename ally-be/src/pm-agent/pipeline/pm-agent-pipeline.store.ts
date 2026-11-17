import { Injectable } from '@nestjs/common';
import { DataSource, In, MoreThan, Not } from 'typeorm';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentCardEvent } from '../entity/pm-agent-card-event.entity';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentRun } from '../entity/pm-agent-run.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmCardStatus,
  PmFeedbackStatus,
  PmLaneStatDimension,
  PmRunStatus,
  PmRunTrigger,
  PmSignalStatus,
} from '../enum/pm-agent.enum';
import { PmStopReason } from '../constants/pm-agent-pipeline.constants';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentEvidenceRepository,
  PmAgentFeedbackRepository,
  PmAgentLaneStatRepository,
  PmAgentMemoryRepository,
  PmAgentRunRepository,
  PmAgentRunStepRepository,
  PmAgentSettingsRepository,
  PmAgentSignalRepository,
} from '../repository/pm-agent.repositories';
import { PmAgentBudgetService } from '../service/pm-agent-budget.service';
import { PM_DEDUPE } from '../constants/pm-agent-pipeline.constants';
import {
  PmDedupeItem,
  PmFeedbackTask,
  PmOutcomeRow,
  PmPersistInput,
  PmPersistResult,
  PmPipelineStore,
} from './pm-pipeline.types';

const UNIQUE_VIOLATION = '23505';

/** Cards that no longer matter for dedupe at all. */
const IGNORED_FOR_DEDUPE = [
  PmCardStatus.DRAFT,
  PmCardStatus.SUPERSEDED,
  PmCardStatus.EXPIRED,
];

/** Finding statuses that mean "not a known problem any more". */
const CLOSED_FINDINGS = ['dismissed', 'rejected', 'cancelled'];

/**
 * The pipeline's reads and writes against Postgres (PmPipelineStore). The Persister is
 * `persistCard`: the only code path that creates a card — one transaction for the card, its
 * `created` event and the UX-signal links, guarded by the queue cap and by the version hash
 * (idempotent: the same candidate persisted twice is one card).
 */
@Injectable()
export class PmAgentPipelineStore implements PmPipelineStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: PmAgentSettingsRepository,
    private readonly cards: PmAgentCardRepository,
    private readonly runs: PmAgentRunRepository,
    private readonly runSteps: PmAgentRunStepRepository,
    private readonly evidence: PmAgentEvidenceRepository,
    private readonly feedback: PmAgentFeedbackRepository,
    private readonly memory: PmAgentMemoryRepository,
    private readonly laneStats: PmAgentLaneStatRepository,
    private readonly signals: PmAgentSignalRepository,
    private readonly opportunities: RoadmapOpportunityRepository,
    private readonly budget: PmAgentBudgetService,
  ) {}

  getSettings(): Promise<PmAgentSettings> {
    return this.settings.getSingleton();
  }

  countOpen(): Promise<number> {
    return this.cards.countOpen();
  }

  findRunning(): Promise<PmAgentRun | null> {
    return this.runs.findRunning();
  }

  async startRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    reservedUsd: number;
    runDate: string;
  }): Promise<PmAgentRun | null> {
    try {
      const row = this.runs.create({
        status: PmRunStatus.RUNNING,
        trigger: input.trigger,
        triggeredBy: input.triggeredBy,
        runDate: input.runDate,
        reservedUsd: input.reservedUsd.toFixed(4),
        spentUsd: '0',
        startedAt: new Date(),
      });
      return await this.runs.save(row);
    } catch (error) {
      // The one-running partial unique index: another replica started a run first.
      if ((error as { code?: string })?.code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async recordSkippedRun(input: {
    trigger: PmRunTrigger;
    triggeredBy: number | null;
    stopReason: string;
    runDate: string;
  }): Promise<string> {
    const now = new Date();
    const saved = await this.runs.save(
      this.runs.create({
        status: PmRunStatus.SKIPPED,
        trigger: input.trigger,
        triggeredBy: input.triggeredBy,
        runDate: input.runDate,
        stopReason: input.stopReason.slice(0, 40),
        startedAt: now,
        finishedAt: now,
      }),
    );
    return saved.id;
  }

  async finishRun(id: string, patch: Partial<PmAgentRun>): Promise<void> {
    await this.runs.update({ id }, patch as never);
  }

  async updateRunSpend(id: string, spentUsd: number): Promise<void> {
    await this.runs.update({ id }, { spentUsd: spentUsd.toFixed(4) });
  }

  async failStaleRuns(olderThanMs: number): Promise<number> {
    const result = await this.runs
      .createQueryBuilder()
      .update(PmAgentRun)
      .set({
        status: PmRunStatus.FAILED,
        stopReason: PmStopReason.ABANDONED,
        finishedAt: () => 'now()',
        error: 'The run stopped reporting (process restart or crash).',
      })
      .where('status = :running', { running: PmRunStatus.RUNNING })
      .andWhere(`"startedAt" < now() - (:ms::int * interval '1 millisecond')`, {
        ms: olderThanMs,
      })
      .execute();
    return result.affected ?? 0;
  }

  async hasRunFor(runDate: string, trigger: PmRunTrigger): Promise<boolean> {
    return (await this.runs.count({ where: { runDate, trigger } })) > 0;
  }

  async recentRunLanes(limit: number): Promise<string[][]> {
    const rows = await this.runs.find({
      where: { status: In([PmRunStatus.COMPLETED, PmRunStatus.FAILED]) },
      order: { startedAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => {
      const selection = (row.lanes as { selection?: { lane?: string }[] })
        ?.selection;
      return Array.isArray(selection)
        ? selection.map((choice) => String(choice?.lane ?? ''))
        : [];
    });
  }

  monthCommittedUsd(now: Date): Promise<number> {
    return this.budget.committedThisMonthUsd(now);
  }

  async pendingFeedback(
    limit: number,
    onlyId?: string,
  ): Promise<PmFeedbackTask[]> {
    const rows = await this.feedback.find({
      where: {
        status: PmFeedbackStatus.PENDING,
        ...(onlyId ? { id: onlyId } : {}),
      },
      order: { reviseNow: 'DESC', createdAt: 'ASC' },
      take: limit,
    });
    const cards = rows.length
      ? await this.cards.find({ where: { id: In(rows.map((r) => r.cardId)) } })
      : [];
    return rows.map((row) => ({
      id: row.id,
      cardId: row.cardId,
      text: row.text,
      chips: Array.isArray(row.chips) ? row.chips : [],
      reviseNow: row.reviseNow,
      createdAt: row.createdAt,
      card: cards.find((card) => card.id === row.cardId) ?? null,
    }));
  }

  async moveFeedback(
    id: string,
    from: string[],
    to: string,
    successorCardId?: string | null,
  ): Promise<boolean> {
    const result = await this.feedback
      .createQueryBuilder()
      .update()
      .set({
        status: to as PmFeedbackStatus,
        ...(successorCardId !== undefined ? { successorCardId } : {}),
      })
      .where('id = :id', { id })
      .andWhere('status IN (:...from)', { from })
      .execute();
    return Boolean(result.affected);
  }

  async dedupeCorpus(): Promise<PmDedupeItem[]> {
    const [cards, opportunities, findings] = await Promise.all([
      this.cards.find({
        where: { status: Not(In(IGNORED_FOR_DEDUPE)) },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
      this.opportunities.find({
        where: {
          stage: In([
            RoadmapOpportunityStage.NEW,
            RoadmapOpportunityStage.PRIORITISED,
            RoadmapOpportunityStage.RELEASED,
          ]),
        },
        select: { id: true, code: true, description: true },
        order: { createdAt: 'DESC' },
        take: PM_DEDUPE.CORPUS_LIMIT,
      }),
      this.dataSource.query(
        `SELECT id, title FROM bug_findings
          WHERE status NOT IN (${CLOSED_FINDINGS.map((_, i) => `$${i + 1}`).join(', ')})
          ORDER BY "createdAt" DESC LIMIT ${PM_DEDUPE.CORPUS_LIMIT}`,
        CLOSED_FINDINGS,
      ) as Promise<{ id: string; title: string }[]>,
    ]);

    const rejectedIds = cards
      .filter((card) => card.status === PmCardStatus.REJECTED)
      .flatMap((card) =>
        Array.isArray(card.payload?.evidenceIds)
          ? card.payload.evidenceIds
          : [],
      );
    const evidence = await this.evidence.listByIds(rejectedIds);
    const keyOf = new Map(
      evidence.map((row) => [row.id, `${row.source}|${row.label}`]),
    );

    return [
      ...cards.map(
        (card): PmDedupeItem => ({
          type: 'card',
          id: card.id,
          label: `"${card.title}"`,
          text: [
            card.payload?.title,
            card.payload?.whyHeadline,
            ...(Array.isArray(card.payload?.change) ? card.payload.change : []),
          ]
            .filter(Boolean)
            .join(' '),
          status: card.status,
          kind: card.kind,
          questionKey: card.questionKey ?? card.payload?.questionKey ?? null,
          evidenceKeys:
            card.status === PmCardStatus.REJECTED &&
            Array.isArray(card.payload?.evidenceIds)
              ? card.payload.evidenceIds
                  .map((id: string) => keyOf.get(id))
                  .filter((key: string | undefined): key is string =>
                    Boolean(key),
                  )
              : undefined,
        }),
      ),
      ...opportunities.map(
        (row): PmDedupeItem => ({
          type: 'opportunity',
          id: row.id,
          label: row.code,
          text: String(row.description ?? '').slice(0, 400),
        }),
      ),
      ...findings.map(
        (row): PmDedupeItem => ({
          type: 'finding',
          id: row.id,
          label: String(row.title ?? '').slice(0, 80),
          text: String(row.title ?? ''),
        }),
      ),
    ];
  }

  isQuestionSuppressed(questionKey: string): Promise<boolean> {
    return this.cards.isQuestionSuppressed(questionKey);
  }

  activeMemory(): Promise<PmAgentMemory[]> {
    return this.memory.find({
      where: { active: true },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
  }

  async outcomeRows(lookbackDays: number): Promise<PmOutcomeRow[]> {
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT o."cardId", c.category, c.kind, c.title, c.payload, c.reason,
              c."reasonChip", o.decision, o."decidedAt", o.merged, o.released,
              o."buildFailed", o.reverted,
              (SELECT e.detail->>'lane' FROM pm_agent_card_events e
                WHERE e."cardId" = c.id AND e.type = 'created'
                ORDER BY e."createdAt" ASC LIMIT 1) AS lane
         FROM pm_agent_outcomes o
         JOIN pm_agent_cards c ON c.id = o."cardId"
        WHERE o."decidedAt" >= now() - ($1::int * interval '1 day')
          AND o.undone = false
        ORDER BY o."decidedAt" DESC
        LIMIT 1000`,
      [lookbackDays],
    );
    return rows.map((row) => ({
      cardId: row.cardId,
      category: row.category,
      lane: row.lane ?? null,
      kind: row.kind,
      decision: row.decision,
      decidedAt: new Date(row.decidedAt),
      merged: Boolean(row.merged),
      released: Boolean(row.released),
      buildFailed: Boolean(row.buildFailed),
      reverted: Boolean(row.reverted),
      title: row.title,
      payload: row.payload ?? {},
      reason: row.reason ?? null,
      reasonChip: row.reasonChip ?? null,
    }));
  }

  async saveLearnedScores(
    rows: { dimension: 'category' | 'lane'; key: string; score: number }[],
  ): Promise<void> {
    for (const row of rows) {
      await this.dataSource.query(
        `INSERT INTO "pm_agent_lane_stats" ("dimension", "key", "decayedScore")
         VALUES ($1::varchar, $2::varchar, $3::double precision)
         ON CONFLICT ("dimension", "key") DO UPDATE
           SET "decayedScore" = EXCLUDED."decayedScore", "updatedAt" = now()`,
        [
          row.dimension === 'lane'
            ? PmLaneStatDimension.LANE
            : PmLaneStatDimension.CATEGORY,
          row.key.slice(0, 64),
          row.score,
        ],
      );
    }
  }

  async bumpShown(category: string, lane: string): Promise<void> {
    await this.laneStats.bump(PmLaneStatDimension.CATEGORY, category, 'shown');
    await this.laneStats.bump(PmLaneStatDimension.LANE, lane, 'shown');
  }

  tenantNames(): Promise<string[]> {
    return this.cards.listTenantNames();
  }

  async hasUxSignals(): Promise<boolean> {
    const count = await this.signals.count({
      where: {
        status: In([PmSignalStatus.NEW, PmSignalStatus.USED]),
        lastSeenAt: MoreThan(new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)),
      },
    });
    return count > 0;
  }

  async persistCard(input: PmPersistInput): Promise<PmPersistResult> {
    const { candidate } = input;
    return this.dataSource.transaction(async (manager) => {
      // One writer per run already (the run lock); the transaction-scoped lock also keeps a
      // second persister (a revise-now racing a scheduled run's tail) from double-counting.
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [1982000, 3]);
      const repo = manager.getRepository(PmAgentCard);
      const duplicate = await repo
        .createQueryBuilder('card')
        .where('card."versionHash" = :hash', { hash: input.versionHash })
        .andWhere('(card."runId" = :runId OR card.status = :open)', {
          runId: input.runId,
          open: PmCardStatus.OPEN,
        })
        .getCount();
      if (duplicate) return { status: 'duplicate' as const };
      const open = await repo.count({ where: { status: PmCardStatus.OPEN } });
      if (open >= input.queueCap) return { status: 'queue_full' as const };

      let version = 1;
      if (candidate.revisedFromCardId) {
        const original = await repo.findOne({
          where: { id: candidate.revisedFromCardId },
          select: { id: true, version: true },
        });
        version = (original?.version ?? 0) + 1;
      }
      const now = new Date();
      const card = await repo.save(
        repo.create({
          runId: input.runId,
          kind: candidate.kind,
          category: candidate.category,
          status: PmCardStatus.OPEN,
          version,
          versionHash: input.versionHash,
          title: String(candidate.payload.title ?? '').slice(0, 200),
          payload: candidate.payload,
          rank: candidate.rank,
          evidenceFreshness: candidate.evidenceFreshness,
          questionKey: candidate.questionKey ?? null,
          revisedFromCardId: candidate.revisedFromCardId ?? null,
          openedAt: now,
        }),
      );
      await manager.getRepository(PmAgentCardEvent).insert({
        cardId: card.id,
        type: 'created',
        fromStatus: null,
        toStatus: PmCardStatus.OPEN,
        cardVersion: card.version,
        actorUserId: null,
        detail: {
          lane: candidate.lane,
          runId: input.runId,
          rank: candidate.rank,
          revisedFromCardId: candidate.revisedFromCardId ?? null,
          feedbackId: candidate.feedbackId ?? null,
          unblocks: Boolean(candidate.unblocks),
        } as never,
      });
      const ids: string[] = Array.isArray(candidate.payload.evidenceIds)
        ? candidate.payload.evidenceIds
        : [];
      if (ids.length) {
        await manager.query(
          `UPDATE "pm_agent_signals" s
              SET status = $1::varchar, "cardId" = $2::uuid, "updatedAt" = now()
             FROM "pm_agent_evidence" e
            WHERE e.id = ANY($3::uuid[]) AND e.source = 'ux_signals'
              AND s.id::text = e.query->>'signalId' AND s.status = $4::varchar`,
          [PmSignalStatus.USED, card.id, ids, PmSignalStatus.NEW],
        );
      }
      return { status: 'created' as const, card };
    });
  }

  async traceGate(
    runId: string,
    layer: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.runSteps.insert({
      runId,
      lane: 'gate',
      kind: 'gate',
      promptCode: null,
      model: null,
      costUsd: '0',
      reservedUsd: '0',
      outcome: 'ok',
      detail: { layer, ...detail } as never,
    });
  }
}
