import { createHash } from 'crypto';
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DebriefProbeResult } from '../entity/debrief-probe-result.entity';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import {
  canaryDecision,
  median,
  trialVerdict,
} from '../util/debrief-ladder.util';
import { runWithConcurrency } from '../../analytics/util/judge-concurrency.util';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';
import {
  AgentReleaseAuthorKind,
  AgentReleaseAuditAction,
} from '../../llm-agent/harness/enum/harness.enum';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefAutonomyService } from './debrief-autonomy.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefRunnerService } from './debrief-runner.service';
import { DebriefSettingsService } from './debrief-settings.service';
import {
  DebriefTestSet,
  DebriefTestSetsService,
} from './debrief-test-sets.service';

/** What the judge costs per debrief, as the learning budget counts it. */
const JUDGE_USD = 0.04;
/** A sealed case's cost when there is no production run to go by: the default run ceiling. */
const SEALED_FALLBACK_RUN_USD = 0.5;
/** How long the active canary is remembered between live runs. */
const CANARY_CACHE_MS = 60_000;

/**
 * Rungs 3 to 5 of the PM agent's test ladder (v9 FR-52, FR-58, FR-59):
 *
 * 3. **Paired trials** on production sessions (switched-on organisations'
 *    only, while no other organisation runs automatically): after a
 *    production debrief is published, a challenger debrief nobody sees
 *    is written for the same session and both are judged blind; results in
 *    `debrief_probe_results`, paid from the learning budget, capped per
 *    session. The trial decides once it has enough pairs.
 * 4. **Canary**: a share of live debriefs in switched-on organisations runs
 *    on the candidate release; it is reverted on its own when it does worse,
 *    or marked ready for a person to promote.
 * 5. **Sealed set**: the release in force on the sealed set, monthly.
 *
 * Every threshold is an owner setting (FR-60).
 */
@Injectable()
export class DebriefTrialsService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefTrialsService.name,
  );
  private canaryCache: {
    at: number;
    value: { ideaId: string; release: AgentRelease; share: number } | null;
  } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefProbeResult)
    private readonly probes: Repository<DebriefProbeResult>,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly pmAgent: DebriefPmAgentService,
    private readonly settings: DebriefSettingsService,
    private readonly releases: AgentReleaseService,
    private readonly testSets: DebriefTestSetsService,
    @Optional() private readonly autonomy?: DebriefAutonomyService,
    @Optional() private readonly notifier?: DebriefNotifier,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'debrief-canary-watch', () =>
      this.watchCanaries().then(() => undefined),
    );
    scheduledTaskRegistry.register('monthly', 'debrief-test-sets', async () => {
      const s = await this.settings.get();
      await this.testSets.rotate(
        DebriefTestSet.GATE,
        s.gateCases,
        s.gateRotationShare,
      );
      await this.sealedRun().catch((e) =>
        this.logger.error(
          `[debrief] sealed run failed: ${(e as Error).message}`,
        ),
      );
    });
  }

  // --- 3. Paired trials ----------------------------------------------------------

  /**
   * After a production debrief is published: if an idea is on its paired
   * trial and the budget allows, write the challenger for the same session,
   * judge both, record the pair and let the trial decide. Never throws: a
   * learner's debrief is already out.
   */
  async onPublished(run: DebriefRun): Promise<void> {
    try {
      if (
        ![DebriefRunMode.SHADOW, DebriefRunMode.LIVE].includes(run.mode) ||
        ![DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
          run.status,
        ) ||
        !run.cards ||
        run.experimentId
      ) {
        return;
      }
      const [idea] = await this.dataSource.query(
        `SELECT l.id FROM agent_lessons l
          WHERE l."agentKey" = 'debrief' AND l.evidence->'trial'->>'status' = 'running'
            AND NOT EXISTS (SELECT 1 FROM debrief_probe_results p
                             WHERE p."ideaId" = l.id AND p."scenarioSessionId" = $1)
          ORDER BY l.evidence->'trial'->>'startedAt' ASC LIMIT 1`,
        [run.scenarioSessionId],
      );
      if (!idea) return;
      const s = await this.settings.get();
      const expected = Number(run.estimatedCostUsd ?? 0) + 2 * JUDGE_USD;
      if (expected > s.probeCapPerSessionUsd) return;
      if (
        (await this.pmAgent.learningSpentThisMonth()) + expected >
        (await this.pmAgent.learningBudgetThisMonth())
      ) {
        return;
      }
      const full = await this.pmAgent.getIdea(idea.id);
      // An organisation may tighten paired trials on its learners' sessions.
      if (
        this.autonomy &&
        !(await this.autonomy.orgAllows(full, 'paired_trial', run.tenantId))
      ) {
        return;
      }
      const baseline =
        run.workspace?.judge ?? (await this.judge.judge(run).catch(() => null));
      const challenger = await this.runner.run(run.scenarioSessionId, {
        mode: DebriefRunMode.REPLAY,
        experimentId: idea.id,
        arm: DebriefRunArm.CHALLENGER,
        ...(await this.pmAgent.challengerOptions(full)),
      });
      const chalJudged = challenger.cards
        ? await this.judge.judge(challenger).catch(() => null)
        : null;
      const scored = baseline?.overall != null && chalJudged?.overall != null;
      await this.probes
        .createQueryBuilder()
        .insert()
        .into(DebriefProbeResult)
        .values({
          tenantId: run.tenantId ?? null,
          ideaId: idea.id,
          scenarioSessionId: run.scenarioSessionId,
          baselineRunId: run.id,
          challengerRunId: challenger.id,
          baselineOverall: baseline?.overall?.toFixed(2) ?? null,
          challengerOverall: chalJudged?.overall?.toFixed(2) ?? null,
          baselineHardFails: baseline?.hardFails?.length ?? 0,
          challengerHardFails: chalJudged?.hardFails?.length ?? 0,
          costUsd: (
            Number(challenger.estimatedCostUsd ?? 0) + JUDGE_USD
          ).toFixed(4),
          status: scored ? 'done' : 'unscored',
        })
        .orIgnore()
        .execute();
      await this.decideTrial(idea.id);
    } catch (e) {
      this.logger.warn(
        `[debrief] paired trial for run ${run.id} failed: ${(e as Error).message}`,
      );
    }
  }

  /** Re-read an idea's pairs and record the trial's state; passing waits for a person to start the canary. */
  async decideTrial(ideaId: string) {
    const rows = await this.probes.find({ where: { ideaId, status: 'done' } });
    const verdict = trialVerdict(
      rows.map((r) => ({
        baseline: r.baselineOverall != null ? Number(r.baselineOverall) : null,
        challenger:
          r.challengerOverall != null ? Number(r.challengerOverall) : null,
        baselineHardFails: r.baselineHardFails,
        challengerHardFails: r.challengerHardFails,
      })),
      await this.settings.get(),
    );
    const idea = await this.pmAgent.getIdea(ideaId);
    await this.pmAgent.writeEvidence(ideaId, 'trial', {
      ...(idea.evidence?.trial ?? {}),
      ...verdict,
      ...(verdict.status !== 'running'
        ? { decidedAt: new Date().toISOString() }
        : {}),
    });
    return verdict;
  }

  // --- 4. Canary ------------------------------------------------------------------

  /**
   * For a live debrief in a switched-on organisation: the canary release when
   * one is running and this session falls in its share (stable per session),
   * else null.
   */
  async canaryFor(
    sessionId: string,
  ): Promise<{ ideaId: string; release: AgentRelease } | null> {
    const now = Date.now();
    if (!this.canaryCache || now - this.canaryCache.at > CANARY_CACHE_MS) {
      // The harness's canary for the debrief agent, and the idea it came from.
      const release = await this.releases.getCanary(DEBRIEF_AGENT_KEY);
      let value = null;
      if (release) {
        const [row] = await this.dataSource.query(
          `SELECT id FROM agent_lessons
            WHERE "agentKey" = 'debrief' AND evidence->'canary'->>'releaseId' = $1
              AND evidence->'canary'->>'status' IN ('running','passed')
            LIMIT 1`,
          [release.id],
        );
        if (row) {
          value = {
            ideaId: row.id as string,
            release,
            share: Number(release.rolloutPercent ?? 0) / 100,
          };
        }
      }
      this.canaryCache = { at: now, value };
    }
    const c = this.canaryCache.value;
    if (!c || c.share <= 0) return null;
    if (this.autonomy && bucket(sessionId) < c.share) {
      // An organisation may tighten canaries on its learners.
      const [s] = await this.dataSource.query(
        `SELECT tenant_id FROM scenario_sessions WHERE id = $1`,
        [sessionId],
      );
      const idea = await this.pmAgent.getIdea(c.ideaId).catch(() => null);
      if (
        idea &&
        !(await this.autonomy.orgAllows(idea, 'canary', s?.tenant_id ?? null))
      ) {
        return null;
      }
    }
    return bucket(sessionId) < c.share
      ? { ideaId: c.ideaId, release: c.release }
      : null;
  }

  /** Compare each running canary with the release in force over the same days; revert or pass it. */
  async watchCanaries(): Promise<number> {
    const rows: Array<{ id: string; canary: Record<string, any> }> =
      await this.dataSource.query(
        `SELECT id, evidence->'canary' AS canary FROM agent_lessons
          WHERE "agentKey" = 'debrief' AND evidence->'canary'->>'status' = 'running'`,
      );
    const s = await this.settings.get();
    for (const { id, canary } of rows) {
      const since = canary.startedAt;
      const stats: Array<{
        arm: string;
        runs: number;
        scores: number[] | null;
        hard_fail_share: number | null;
        missed_risk: number;
      }> = await this.dataSource.query(
        `SELECT CASE WHEN "experimentId" = $1 THEN 'canary' ELSE 'control' END AS arm,
                count(*)::int AS runs,
                array_agg((workspace->'judge'->>'overall')::float)
                  FILTER (WHERE workspace->'judge'->>'overall' IS NOT NULL) AS scores,
                avg(CASE WHEN jsonb_array_length(COALESCE(workspace->'judge'->'hardFails','[]'::jsonb)) > 0
                         THEN 1 ELSE 0 END) FILTER (WHERE workspace ? 'judge') AS hard_fail_share,
                count(*) FILTER (WHERE workspace->'judge'->'hardFails' @> '[{"code":"missed_risk_cue"}]')::int AS missed_risk
           FROM debrief_runs
          WHERE mode = 'live' AND status IN ('published','below_bar')
            AND "createdAt" >= $2 AND ("experimentId" = $1 OR "experimentId" IS NULL)
          GROUP BY 1`,
        [id, since],
      );
      const c = stats.find((x) => x.arm === 'canary');
      const k = stats.find((x) => x.arm === 'control');
      const controlMissed = k?.missed_risk ?? 0;
      const reading = {
        canaryRuns: c?.runs ?? 0,
        controlRuns: k?.runs ?? 0,
        canaryMedian: median(c?.scores ?? []),
        controlMedian: median(k?.scores ?? []),
        canaryHardFailShare:
          c?.hard_fail_share != null ? Number(c.hard_fail_share) : null,
        controlHardFailShare:
          k?.hard_fail_share != null ? Number(k.hard_fail_share) : null,
        // A missed risk cue reverts only when the release in force had none.
        canaryMissedRiskCues: controlMissed > 0 ? 0 : (c?.missed_risk ?? 0),
        days: Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000),
      };
      const decision = canaryDecision(reading, s);
      await this.pmAgent.writeEvidence(id, 'canary', {
        ...canary,
        ...reading,
        status: decision.status,
        reason: decision.reason,
        checkedAt: new Date().toISOString(),
      });
      if (decision.status === 'reverted') {
        // Back to the release in force for everyone; a missed risk cue moves
        // every learner at once.
        await this.releases
          .stopCanary(
            DEBRIEF_AGENT_KEY,
            null,
            reading.canaryMissedRiskCues > 0,
            decision.reason,
            {
              actorKind: AgentReleaseAuthorKind.SYSTEM,
              action: AgentReleaseAuditAction.CANARY_REVERTED,
              detail: { ideaId: id, ...reading },
            },
          )
          .catch((e) =>
            this.logger.error(
              `[debrief] could not stop the canary for idea ${id}: ${(e as Error).message}`,
            ),
          );
      }
      if (decision.status === 'reverted') {
        // FR-54: every revert tells the owner, a learner try-out's own included.
        await this.notifier?.owner({
          title: 'Debriefs: a learner try-out was taken back on its own',
          body: decision.reason,
          data: { ideaId: id, releaseId: canary.releaseId ?? null },
        });
      }
      if (decision.status !== 'running') {
        this.canaryCache = null;
        this.logger.warn(
          `[debrief] canary for idea ${id} ${decision.status}: ${decision.reason}`,
        );
      }
    }
    return rows.length;
  }

  // --- 5. Sealed set ---------------------------------------------------------------

  /**
   * The release in force on the sealed set (owner setting `sealedCases`),
   * judged; the result is kept in the PM agent's audit trail so the Console
   * can show the monthly series. Paid from the learning budget.
   */
  async sealedRun(): Promise<Record<string, unknown> | null> {
    const s = await this.settings.get();
    const sessions = await this.testSets.sessions(
      DebriefTestSet.SEALED,
      s.sealedCases,
    );
    if (!sessions.length) return null;
    // Paid from the learning budget: start only when the whole run fits, so
    // a month's result is never an overspend or a partial measurement.
    const perCase = (await this.typicalRunCostUsd()) + JUDGE_USD;
    const leftUsd =
      (await this.pmAgent.learningBudgetThisMonth()) -
      (await this.pmAgent.learningSpentThisMonth());
    const needUsd = sessions.length * perCase;
    if (needUsd > leftUsd) {
      const skipped = {
        step: 'sealed_run',
        status: 'skipped',
        reason: 'learning_budget',
        cases: sessions.length,
        needUsd: Math.round(needUsd * 100) / 100,
        leftUsd: Math.round(Math.max(0, leftUsd) * 100) / 100,
        ranAt: new Date().toISOString(),
      };
      this.logger.warn(
        `[debrief] sealed run skipped: needs about $${skipped.needUsd}, $${skipped.leftUsd} of the learning budget left`,
      );
      await this.pmAgent.recordLadderEvent(skipped);
      return skipped;
    }
    const scores: number[] = [];
    let hardFails = 0;
    let failures = 0;
    let stoppedForBudget = 0;
    let cost = 0;
    let inFlight = 0;
    let finished = 0;
    await runWithConcurrency(sessions, 3, async (sessionId) => {
      // The estimate can be wrong: once cases finish, go by what they really
      // cost, and never start a case that could spend past what was left.
      const each = Math.max(perCase, finished ? cost / finished : 0);
      if (cost + (inFlight + 1) * each > leftUsd) {
        stoppedForBudget++;
        return;
      }
      inFlight++;
      const run = await this.runner
        .run(sessionId, { mode: DebriefRunMode.REPLAY })
        .finally(() => inFlight--);
      cost += Number(run.estimatedCostUsd ?? 0) + JUDGE_USD;
      finished++;
      const judged = run.cards
        ? await this.judge.judge(run).catch(() => null)
        : null;
      if (judged?.overall == null) {
        failures++;
        return;
      }
      scores.push(judged.overall);
      if (judged.hardFails.length) hardFails++;
    });
    const result = {
      step: 'sealed_run',
      cases: sessions.length,
      scored: scores.length,
      median: median(scores),
      hardFails,
      failures,
      stoppedForBudget,
      costUsd: Math.round(cost * 100) / 100,
      ranAt: new Date().toISOString(),
    };
    await this.pmAgent.recordLadderEvent(result);
    return result;
  }

  /** A debrief's typical cost lately: the median of the last 100 production runs, or the default run ceiling when there are none. */
  private async typicalRunCostUsd(): Promise<number> {
    const [r] = await this.dataSource.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c)::float AS p50
         FROM (SELECT COALESCE("actualCostUsd", "estimatedCostUsd")::float AS c
                 FROM debrief_runs
                WHERE mode IN ('shadow','live') AND status <> 'skipped'
                  AND COALESCE("actualCostUsd", "estimatedCostUsd") IS NOT NULL
                ORDER BY "createdAt" DESC
                LIMIT 100) t`,
    );
    const p50 = Number(r?.p50);
    return Number.isFinite(p50) && p50 > 0 ? p50 : SEALED_FALLBACK_RUN_USD;
  }
}

/** A stable number in [0, 1) per session, so a session is always in or out of the canary. */
export function bucket(sessionId: string): number {
  const h = createHash('sha256').update(`canary:${sessionId}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}
