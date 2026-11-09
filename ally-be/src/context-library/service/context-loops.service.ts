import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  CL_JUDGE_DEFAULT_SAMPLE_RATE,
  CL_LOOP_WINDOW_DAYS,
} from '../constants/context-library.constants';
import { ClCollection, ClLoopSettings } from '../entity/cl-collection.entity';
import { ClLoop } from '../enum/context-library.enum';
import { getProfile } from '../profiles';
import { mean, ndcgAt } from '../util/loops.util';
import { ContextAgentCuratorService } from './context-agent-curator.service';
import { ContextGapsService } from './context-gaps.service';
import { ContextJudgeService } from './context-judge.service';
import { ContextLearningService } from './context-learning.service';
import { ContextLoopActionsService } from './context-loop-actions.service';
import { ContextTuningService } from './context-tuning.service';

export const CL_LOOPS_DAILY_TASK = 'context-library-loops';
export const CL_LOOPS_WEEKLY_TASK = 'context-library-tuning';

export interface LoopRunReport {
  collectionId: string;
  judged?: number;
  learnedQueries?: number;
  effectiveness?: number;
  curated?: number;
  gaps?: number;
  rolledBack?: boolean;
  tuned?: boolean;
  errors: string[];
}

/**
 * Runs the learning loops (docs/context-library/PLAN.md §8), nightly and per collection, and
 * serves Insights. Order matters: the judge labels first, so query learning and the curator
 * read tonight's labels; effectiveness before the curator, which reads usage; gaps last.
 * Tuning is weekly and has its own minimum gap between promotions; rollback is checked daily.
 *
 * Every step is independent and fail-soft — one loop failing never stops the others.
 */
@Injectable()
export class ContextLoopsService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(ContextLoopsService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly judge: ContextJudgeService,
    private readonly learning: ContextLearningService,
    private readonly gaps: ContextGapsService,
    private readonly tuning: ContextTuningService,
    private readonly actions: ContextLoopActionsService,
    private readonly agentCurator: ContextAgentCuratorService,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', CL_LOOPS_DAILY_TASK, () =>
      this.runNightly().then(() => undefined),
    );
    scheduledTaskRegistry.register('weekly', CL_LOOPS_WEEKLY_TASK, () =>
      this.runTuning().then(() => undefined),
    );
  }

  private paused(settings: ClLoopSettings | null | undefined, loop: ClLoop) {
    return (settings?.paused ?? []).includes(loop);
  }

  async runNightly(only?: string): Promise<LoopRunReport[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const judged = await this.judge.run().catch((error) => {
        this.logger.warn(`Judge loop failed: ${(error as Error).message}`);
        return 0;
      });
      const collections = await this.collections.find({
        where: { status: 'active' },
      });
      const reports: LoopRunReport[] = [];
      for (const c of collections) {
        if (only && c.id !== only) continue;
        if (!getProfile(c.id)) continue;
        const report: LoopRunReport = {
          collectionId: c.id,
          judged,
          errors: [],
        };
        const step = async <T>(loop: ClLoop, fn: () => Promise<T>) => {
          if (this.paused(c.loopSettings, loop)) return undefined;
          try {
            return await fn();
          } catch (error) {
            report.errors.push(`${loop}: ${(error as Error).message}`);
            return undefined;
          }
        };
        report.learnedQueries = await step(ClLoop.QUERY_LEARNING, () =>
          this.learning.learnQueries(c.id),
        );
        report.effectiveness = await step(ClLoop.EFFECTIVENESS, () =>
          this.learning.recomputeEffectiveness(c.id),
        );
        // Agent-written collections also retire by usage here (§8): the hourly agent curator
        // folds candidates in, this takes out what runs keep not applying or contradicting.
        report.curated = await step(ClLoop.CURATOR, async () => {
          const curated = await this.learning.curate(c.id);
          return getProfile(c.id)?.agentCuration
            ? curated + (await this.agentCurator.retireByUsage(c.id))
            : curated;
        });
        report.gaps = await step(ClLoop.GAPS, () => this.gaps.run(c.id));
        report.rolledBack = await step(ClLoop.ROLLBACK, () =>
          this.tuning.rollbackIfWorse(c.id),
        );
        if (report.errors.length)
          this.logger.warn(
            `Context Library loops for ${c.id}: ${report.errors.join('; ')}`,
          );
        reports.push(report);
      }
      return reports;
    } finally {
      this.running = false;
    }
  }

  async runTuning(only?: string): Promise<LoopRunReport[]> {
    const collections = await this.collections.find({
      where: { status: 'active' },
    });
    const reports: LoopRunReport[] = [];
    for (const c of collections) {
      if (only && c.id !== only) continue;
      if (!getProfile(c.id) || this.paused(c.loopSettings, ClLoop.TUNING))
        continue;
      const report: LoopRunReport = { collectionId: c.id, errors: [] };
      try {
        report.tuned = await this.tuning.tune(c.id);
      } catch (error) {
        report.errors.push(`tuning: ${(error as Error).message}`);
      }
      reports.push(report);
    }
    return reports;
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async settings(collectionId: string) {
    const c = await this.collections.findOneOrFail({
      where: { id: collectionId },
    });
    const profile = getProfile(collectionId);
    return {
      collectionId,
      judgeSampleRate:
        c.loopSettings?.judgeSampleRate ?? CL_JUDGE_DEFAULT_SAMPLE_RATE,
      paused: c.loopSettings?.paused ?? [],
      loops: Object.values(ClLoop),
      searchSetup: c.activeSearchSetup ?? profile?.retrievalDefaults ?? null,
      searchSetupIsDefault: !c.activeSearchSetup,
      setupPromotedAt: c.setupPromotedAt ?? null,
    };
  }

  async updateSettings(
    collectionId: string,
    patch: { judgeSampleRate?: number; paused?: string[] },
  ) {
    const c = await this.collections.findOneOrFail({
      where: { id: collectionId },
    });
    const valid = new Set<string>(Object.values(ClLoop));
    const next: ClLoopSettings = { ...(c.loopSettings ?? {}) };
    if (patch.judgeSampleRate !== undefined)
      next.judgeSampleRate = Math.min(1, Math.max(0, patch.judgeSampleRate));
    if (patch.paused !== undefined)
      next.paused = [...new Set(patch.paused.filter((p) => valid.has(p)))];
    await this.collections.update({ id: collectionId }, { loopSettings: next });
    return this.settings(collectionId);
  }

  // ── Insights ────────────────────────────────────────────────────────────────

  /**
   * Per collection: is it helping, what's missing, what changed, and — for owners — written
   * entries that never help. Sensitive query text never appears: gaps carry only the model's
   * label and non-sensitive examples.
   */
  async insights(collectionId: string, days = 30) {
    const window = String(Math.min(Math.max(days, 1), CL_LOOP_WINDOW_DAYS));
    const [usage, judged, weekly, holdout] = await Promise.all([
      this.dataSource.query(
        `SELECT use_case,
                count(*) FILTER (WHERE type = 'surfaced') AS surfaced,
                count(*) FILTER (WHERE type = 'read') AS read,
                count(*) FILTER (WHERE type = 'cited') AS cited,
                count(*) FILTER (WHERE type IN ('applied_verified', 'agent_applied', 'shipped')) AS applied,
                count(*) FILTER (WHERE type = 'cite_rejected') AS rejected
         FROM cl_usage_events
         WHERE collection_id = $1 AND "createdAt" > now() - ($2 || ' days')::interval
         GROUP BY use_case ORDER BY surfaced DESC`,
        [collectionId, window],
      ),
      this.dataSource.query(
        `SELECT count(*) AS n, count(*) FILTER (WHERE grade >= 2) AS useful,
                count(DISTINCT retrieval_id) AS searches
         FROM cl_judgments
         WHERE collection_id = $1 AND final_rank IS NOT NULL
           AND "createdAt" > now() - ($2 || ' days')::interval`,
        [collectionId, window],
      ),
      this.dataSource.query(
        `SELECT date_trunc('week', "createdAt") AS week,
                count(*) AS n, count(*) FILTER (WHERE grade >= 2) AS useful
         FROM cl_judgments
         WHERE collection_id = $1 AND final_rank IS NOT NULL
           AND "createdAt" > now() - interval '84 days'
         GROUP BY 1 ORDER BY 1`,
        [collectionId],
      ),
      this.dataSource.query(
        `SELECT j.retrieval_id, json_agg(json_build_object('id', j.chunk_id, 'grade', j.grade, 'rank', j.final_rank)) AS rows
         FROM cl_judgments j
         WHERE j.collection_id = $1 AND j.split = 'holdout'
           AND j."createdAt" > now() - ($2 || ' days')::interval
         GROUP BY j.retrieval_id`,
        [collectionId, window],
      ),
    ]);
    const [j] = judged as Array<{
      n: string;
      useful: string;
      searches: string;
    }>;
    // Live nDCG@8 on the holdout: how the order users actually saw compares with the best
    // order of what the judge rated.
    const ndcgs = (
      holdout as Array<{
        rows: Array<{ id: string; grade: number; rank: number | null }>;
      }>
    ).map(({ rows }) => {
      const grades = new Map(rows.map((r) => [r.id, Number(r.grade)]));
      const shown = rows
        .filter((r) => r.rank !== null)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map((r) => r.id);
      return ndcgAt(shown, grades, 8);
    });
    const [gaps, changes, neverUseful, settings] = await Promise.all([
      this.gaps.list(collectionId),
      this.actions.list(collectionId, 30),
      this.learning.neverUsefulEntries(collectionId),
      this.settings(collectionId),
    ]);
    const n = Number(j?.n ?? 0);
    return {
      collectionId,
      days: Number(window),
      helping: {
        precision: n ? Number(j.useful) / n : null,
        judgedResults: n,
        judgedSearches: Number(j?.searches ?? 0),
        holdoutNdcg: mean(ndcgs),
        holdoutSearches: ndcgs.length,
        weekly: (
          weekly as Array<{ week: string; n: string; useful: string }>
        ).map((w) => ({
          week: w.week,
          precision: Number(w.n) ? Number(w.useful) / Number(w.n) : null,
          judged: Number(w.n),
        })),
        byUseCase: (usage as any[]).map((u) => ({
          useCase: u.use_case,
          surfaced: Number(u.surfaced),
          read: Number(u.read),
          cited: Number(u.cited),
          applied: Number(u.applied),
          rejectedCitations: Number(u.rejected),
        })),
      },
      missing: gaps,
      changes,
      forOwners: neverUseful,
      settings,
    };
  }
}
