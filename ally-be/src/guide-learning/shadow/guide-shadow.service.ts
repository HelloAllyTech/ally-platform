import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoggerService } from 'src/logger/logger.service';
import { AgentShadowReport } from 'src/llm-agent/entity/agent-shadow-report.entity';
import { AgentShadowStatus } from 'src/llm-agent/harness/enum/learning.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { runDeterministicChecks } from '../checks/deterministic-checks';
import { wordCount } from '../checks/text.util';
import { REPLAY_CONCURRENCY } from '../constants/guide-learning.constants';
import { GuideEvalCaseService } from '../evals/guide-eval-case.service';
import { GuideEvalRunService } from '../evals/guide-eval-run.service';
import { GuideWindowService } from '../windows/guide-window.service';
import { ShadowPair, compareShadow } from './shadow-compare';

/** How far back a shadow looks for real turns (days). */
export const SHADOW_LOOKBACK_DAYS = 7;

const jsonb = (value: Record<string, unknown>) =>
  value as unknown as QueryDeepPartialEntity<AgentShadowReport>['summary'];

/**
 * Shadow replay (plans/ally-guide/plan.md §7.4, Stacks: Shadow Deployments
 * for Safe Agent Validation): the candidate answers recent real GA turns in
 * dry run — the real Sentinel, orchestrator and Tutor, every write stubbed,
 * nothing shown to anyone — and both answers are graded by the same
 * deterministic checks. A new safety failure or a crisis disagreement fails
 * it outright; quality may not fall by more than the policy's margin.
 *
 * Turns are replayed from their redacted text; a turn whose learner message
 * named a real person is skipped, as "Save as eval case" does.
 */
@Injectable()
export class GuideShadowService {
  private readonly logger = LoggerService.getInstance(GuideShadowService.name);

  constructor(
    @InjectRepository(AgentShadowReport)
    private readonly reports: Repository<AgentShadowReport>,
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly windows: GuideWindowService,
    private readonly cases: GuideEvalCaseService,
    private readonly runs: GuideEvalRunService,
  ) {}

  /** Recent real learner turns GA answered, newest first. */
  async recentGaTurns(gaId: string, limit: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT t."id" FROM "agent_turns" t
        WHERE t."agentKey" = $1 AND t."releaseId" = $2
          AND t."status" = 'completed' AND t."trigger" = 'learner_message'
          AND COALESCE(t."arm", 'ga') = 'ga'
          AND t."createdAt" >= now() - ($3::int * interval '1 day')
        ORDER BY t."createdAt" DESC
        LIMIT $4`,
      [ALLY_GUIDE_AGENT_KEY, gaId, SHADOW_LOOKBACK_DAYS, limit],
    );
    return rows.map((row) => row.id);
  }

  /** Start a shadow in the background (the Console's button). */
  async start(releaseId: string, userId: number | null) {
    const report = await this.open(releaseId, userId);
    setImmediate(() => {
      void this.execute(report.id).catch((error) =>
        this.logger.error(
          `Shadow ${report.id} crashed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    return report;
  }

  /** Run a shadow to the end (the pipeline awaits it). */
  async run(releaseId: string, userId: number | null) {
    const report = await this.open(releaseId, userId);
    return this.execute(report.id);
  }

  private async open(
    releaseId: string,
    userId: number | null,
  ): Promise<AgentShadowReport> {
    const release = await this.releases.getById(releaseId);
    if (release.agentKey !== ALLY_GUIDE_AGENT_KEY) {
      throw new BadRequestException('Not an Ally release');
    }
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga || ga.id === release.id) {
      throw new BadRequestException('A shadow compares a candidate with GA');
    }
    const running = await this.reports.findOne({
      where: { releaseId, status: AgentShadowStatus.RUNNING },
    });
    if (running) {
      throw new ConflictException(
        'A shadow is already running for this release',
      );
    }
    const report = await this.reports.save(
      this.reports.create({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        releaseId,
        baselineReleaseId: ga.id,
        status: AgentShadowStatus.RUNNING,
        triggeredBy: userId,
      }),
    );
    await this.releases.recordShadow({
      releaseId,
      reportId: report.id,
      phase: 'started',
      userId,
    });
    return report;
  }

  async execute(reportId: string): Promise<AgentShadowReport> {
    const report = await this.get(reportId);
    try {
      const release = await this.releases.getById(report.releaseId);
      const policy = loopPolicy(
        (release.bundle as unknown as GuideReleaseBundle).policy,
      );
      const turnIds = await this.recentGaTurns(
        report.baselineReleaseId!,
        policy.shadowSampleTurns * 2,
      );
      const crisisTexts = await this.windows.approvedCrisisTexts();
      const pairs: ShadowPair[] = [];
      let cost = 0;
      const jobs: Array<() => Promise<void>> = [];
      for (const turnId of turnIds) {
        if (jobs.length >= policy.shadowSampleTurns) break;
        const window = await this.windows.loadTurn(turnId, 4);
        if (!window) continue;
        const input = await this.cases.inputFromWindow(window);
        if (!input) continue;
        jobs.push(async () => {
          const replay = await this.runs.replay(
            { input, expectations: {}, safety: false },
            report.releaseId,
            { crisisTexts, quizKeys: window.window.quizKeys },
          );
          cost += replay.costUsd;
          pairs.push({
            turnId,
            ga: {
              checks: runDeterministicChecks(window.window),
              crisis: window.window.reply.kind === 'crisis',
              words: wordCount(window.window.reply.text),
            },
            candidate: {
              checks: replay.checks,
              crisis: replay.output?.replyKind === 'crisis',
              words: wordCount(String(replay.output?.reply ?? '')),
              error: replay.error,
            },
          });
        });
      }
      let next = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(REPLAY_CONCURRENCY, jobs.length) },
          async () => {
            while (next < jobs.length) await jobs[next++]();
          },
        ),
      );
      const summary = compareShadow(pairs, {
        minTurns: policy.shadowMinTurns,
        qualityMargin: policy.qualityMargin,
      });
      await this.reports.update(report.id, {
        status: summary.status,
        turnCount: summary.turns,
        summary: jsonb({ ...summary }),
        costUsd: cost.toFixed(6),
        completedAt: new Date(),
      });
      await this.releases.recordShadow({
        releaseId: report.releaseId,
        reportId: report.id,
        phase:
          summary.status === AgentShadowStatus.PASSED
            ? 'passed'
            : summary.status === AgentShadowStatus.INCONCLUSIVE
              ? 'inconclusive'
              : 'failed',
        userId: report.triggeredBy ?? null,
        detail: { reasons: summary.reasons, turns: summary.turns },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Shadow ${report.id} failed: ${message}`);
      await this.reports.update(report.id, {
        status: AgentShadowStatus.ERROR,
        summary: jsonb({ error: message.slice(0, 500) }),
        completedAt: new Date(),
      });
      await this.releases
        .recordShadow({
          releaseId: report.releaseId,
          reportId: report.id,
          phase: 'inconclusive',
          userId: report.triggeredBy ?? null,
          detail: { error: message.slice(0, 200) },
        })
        .catch(() => undefined);
    }
    return this.get(report.id);
  }

  async get(id: string): Promise<AgentShadowReport> {
    const report = await this.reports.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!report) throw new NotFoundException('Shadow report not found');
    return report;
  }

  list(releaseId?: string) {
    return this.reports.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        ...(releaseId ? { releaseId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
