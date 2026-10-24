import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoggerService } from 'src/logger/logger.service';
import { AgentSyntheticRun } from 'src/llm-agent/entity/agent-synthetic-run.entity';
import { AgentSyntheticRunStatus } from 'src/llm-agent/harness/enum/learning.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { GuideEvalRunService } from '../evals/guide-eval-run.service';
import { GuideWindowService } from '../windows/guide-window.service';
import { SyntheticJourneyResult, syntheticDrift } from './synthetic-drift';
import { SYNTHETIC_PERSONAS, SyntheticPersona } from './synthetic-personas';

export const SYNTHETIC_TASK = 'ally-guide-synthetic-monitoring';
/** The busiest courses a night covers. */
export const SYNTHETIC_TOP_COURSES = 3;
/** Earlier nights the drift baseline reads. */
export const SYNTHETIC_BASELINE_NIGHTS = 7;

const jsonb = (value: Record<string, unknown>) =>
  value as unknown as QueryDeepPartialEntity<AgentSyntheticRun>['summary'];

const today = () => new Date().toISOString().slice(0, 10);

export interface JourneyOutcome extends SyntheticJourneyResult {
  persona: string;
  trackId: string;
  steps: Array<{
    passed: boolean;
    safetyFailed: boolean;
    failedChecks: string[];
    replyKind: string | null;
    latencyMs: number | null;
    error: string | null;
  }>;
}

/**
 * Synthetic monitoring (plans/ally-guide/plan.md §7.12): every night the GA
 * release answers scripted journeys — the persona presets × the busiest
 * courses — through the Playground's dry run, and each reply is checked
 * like an eval case. It catches drift from a provider changing a model
 * under the same name and from course edits, before learners do. Drift
 * raises the `synthetic_drift` alert. No learner is involved; the cost goes
 * to the learning loop's ledger key.
 */
@Injectable()
export class GuideSyntheticService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GuideSyntheticService.name,
  );

  constructor(
    @InjectRepository(AgentSyntheticRun)
    private readonly synthetic: Repository<AgentSyntheticRun>,
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly runs: GuideEvalRunService,
    private readonly windows: GuideWindowService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', SYNTHETIC_TASK, () =>
      this.runNight().then(() => undefined),
    );
  }

  /** The courses with the most Ally conversations in the last 30 days. */
  async topCourses(limit = SYNTHETIC_TOP_COURSES): Promise<string[]> {
    const rows: Array<{ trackId: string }> = await this.dataSource.query(
      `SELECT "trackId" FROM "guide_threads"
        WHERE "updatedAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY count(*) DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => row.trackId);
  }

  async runNight(
    personas: SyntheticPersona[] = SYNTHETIC_PERSONAS,
  ): Promise<AgentSyntheticRun | null> {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga) return null;
    const courses = await this.topCourses();
    if (!courses.length) {
      this.logger.info(
        'Synthetic monitoring: no course has Ally conversations yet',
      );
      return null;
    }
    const policy = loopPolicy(
      (ga.bundle as unknown as GuideReleaseBundle).policy,
    );
    const run = await this.synthetic.save(
      this.synthetic.create({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        releaseId: ga.id,
        night: today(),
        status: AgentSyntheticRunStatus.RUNNING,
      }),
    );
    try {
      const crisisTexts = await this.windows.approvedCrisisTexts();
      const journeys: JourneyOutcome[] = [];
      let cost = 0;
      for (const trackId of courses) {
        const quizKeys = await this.windows.quizKeys(trackId, null);
        for (const persona of personas) {
          const history: Array<{ role: 'learner' | 'ally'; text: string }> = [];
          const steps: JourneyOutcome['steps'] = [];
          for (const step of persona.steps) {
            const replay = await this.runs.replay(
              {
                input: {
                  trackId,
                  progress: persona.progress,
                  guidance: persona.guidance,
                  channel: persona.channel,
                  mode: 'NORMAL',
                  history: [...history],
                  message: step.message,
                  ...(persona.quizOpen ? { quizOpen: true } : {}),
                },
                expectations: step.expect ?? {},
                safety: persona.safety,
              },
              ga.id,
              { crisisTexts, quizKeys },
            );
            cost += replay.costUsd;
            steps.push({
              passed: replay.passed && !replay.error,
              safetyFailed: replay.safetyFailed,
              failedChecks: replay.checks
                .filter((c) => c.applicable && !c.passed)
                .map((c) => String(c.id)),
              replyKind:
                (replay.output?.replyKind as string | undefined) ?? null,
              latencyMs: replay.latencyMs,
              error: replay.error,
            });
            history.push(
              { role: 'learner', text: step.message },
              { role: 'ally', text: String(replay.output?.reply ?? '') },
            );
          }
          journeys.push({
            key: `${persona.id}:${trackId}`,
            persona: persona.id,
            trackId,
            passed: steps.every((s) => s.passed),
            steps,
          });
        }
      }
      const stepCount = journeys.reduce((n, j) => n + j.steps.length, 0);
      const passedSteps = journeys.reduce(
        (n, j) => n + j.steps.filter((s) => s.passed).length,
        0,
      );
      const safetyFailures = journeys.reduce(
        (n, j) => n + j.steps.filter((s) => s.safetyFailed).length,
        0,
      );
      const passRate = stepCount
        ? Number((passedSteps / stepCount).toFixed(4))
        : null;
      const recent = await this.recentCompleted(run.id);
      const verdict = syntheticDrift({
        passRate,
        safetyFailures,
        journeys,
        recentPassRates: recent
          .map((r) => r.passRate)
          .filter((v): v is number => typeof v === 'number'),
        lastNight:
          (recent[0]?.summary?.journeys as
            | SyntheticJourneyResult[]
            | undefined) ?? null,
        drop: policy.syntheticDriftDrop,
      });
      await this.synthetic.update(run.id, {
        status: AgentSyntheticRunStatus.COMPLETED,
        journeys: journeys.length,
        turns: stepCount,
        passRate,
        safetyFailures,
        drift: verdict.drift,
        costUsd: cost.toFixed(6),
        completedAt: new Date(),
        summary: jsonb({
          releaseVersion: ga.version,
          courses,
          verdict,
          journeys: journeys.map((j) => ({
            key: j.key,
            persona: j.persona,
            trackId: j.trackId,
            passed: j.passed,
            steps: j.steps,
          })),
        }),
      });
      if (verdict.drift) {
        this.logger.warn(
          `Synthetic monitoring drift on v${ga.version}: ${verdict.reasons.join('; ')}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Synthetic run ${run.id} failed: ${message}`);
      await this.synthetic.update(run.id, {
        status: AgentSyntheticRunStatus.ERROR,
        completedAt: new Date(),
        summary: jsonb({ error: message.slice(0, 500) }),
      });
    }
    return this.get(run.id);
  }

  private recentCompleted(excludeId: string) {
    return this.dataSource
      .getRepository(AgentSyntheticRun)
      .createQueryBuilder('r')
      .where('r."agentKey" = :agentKey', { agentKey: ALLY_GUIDE_AGENT_KEY })
      .andWhere('r."status" = :status', {
        status: AgentSyntheticRunStatus.COMPLETED,
      })
      .andWhere('r."id" <> :excludeId', { excludeId })
      .orderBy('r."createdAt"', 'DESC')
      .limit(SYNTHETIC_BASELINE_NIGHTS)
      .getMany();
  }

  async get(id: string): Promise<AgentSyntheticRun> {
    const run = await this.synthetic.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!run) throw new NotFoundException('Synthetic run not found');
    return run;
  }

  list(limit = 30) {
    return this.synthetic.find({
      where: { agentKey: ALLY_GUIDE_AGENT_KEY },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 120),
    });
  }
}
