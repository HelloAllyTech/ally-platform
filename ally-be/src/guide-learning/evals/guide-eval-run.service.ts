import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoggerService } from 'src/logger/logger.service';
import { AgentEvalCase } from 'src/llm-agent/entity/agent-eval-case.entity';
import { AgentEvalResult } from 'src/llm-agent/entity/agent-eval-result.entity';
import { AgentEvalRun } from 'src/llm-agent/entity/agent-eval-run.entity';
import {
  AgentEvalRunKind,
  AgentEvalRunStatus,
} from 'src/llm-agent/harness/enum/eval.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { GuideAdminService } from 'src/guide/admin/guide-admin.service';
import {
  GuidePlaygroundService,
  PlaygroundInput,
} from 'src/guide/admin/guide-playground.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  evaluatorPolicy,
} from 'src/guide/release/guide-release.bundle';
import { redactText } from 'src/guide/safety/redaction';
import {
  CheckResult,
  EvalWindow,
  QuizKey,
  failedChecks,
  hasSafetyFailure,
  qualityScore,
  runDeterministicChecks,
} from '../checks/deterministic-checks';
import { readSituation } from '../checks/situation';
import {
  GUIDE_LEARNING_COST_KEY,
  REPLAY_CONCURRENCY,
  SMOKE_MAX_CASES,
  SUITE_KEYS,
} from '../constants/guide-learning.constants';
import { GuideWindowService } from '../windows/guide-window.service';
import { RED_TEAM_CATEGORY_IDS } from './categories';
import { checkExpectations, GuideCaseExpectations } from './expectations';
import {
  ArmLearningMetrics,
  CaseOutcome,
  GuardResult,
  RepetitionResult,
  decideGate,
  learningGuard,
} from './gate';
import {
  GuideCaseInput,
  GuideEvalCaseService,
} from './guide-eval-case.service';

/** A plain object for a jsonb column in `update()`, whose typing rejects nested records. */
const jsonb = (value: Record<string, unknown>) =>
  value as unknown as QueryDeepPartialEntity<AgentEvalRun>['summary'];

/** The canary window the learning guard reads (days). */
const GUARD_WINDOW_DAYS = 14;

export interface ReplayResult {
  checks: CheckResult[];
  passed: boolean;
  safetyFailed: boolean;
  quality: number;
  output: Record<string, unknown> | null;
  error: string | null;
  latencyMs: number | null;
  costUsd: number;
}

/** Run `fn` over `items`, `limit` at a time. */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Eval runs (plans/ally-guide/plan.md §7.13, §7.4 "smoke suite"): a release
 * replayed against the cases through the Playground's dry-run turn — the
 * real Sentinel, orchestrator and Tutor, with every write tool stubbed and
 * nothing stored — then checked deterministically against each case's
 * expectations. No model grades a gate: its verdict has to be reproducible.
 *
 *  - smoke: the smoke suite (or, while it is empty, the first cases of each
 *    hard category), once, no baseline. For drafts; minutes, not hours.
 *  - gate: every active case, three repetitions, against the GA release as
 *    the baseline; decided by `decideGate`. A DRAFT moves to EVALUATING,
 *    then to CANDIDATE or back to DRAFT, with the run as its evidence.
 *
 * Runs execute in this process after the request returns; the plan's SQS
 * worker is the scale-out path when suites outgrow it.
 */
@Injectable()
export class GuideEvalRunService {
  private readonly logger = LoggerService.getInstance(GuideEvalRunService.name);

  constructor(
    @InjectRepository(AgentEvalRun)
    private readonly runs: Repository<AgentEvalRun>,
    @InjectRepository(AgentEvalResult)
    private readonly results: Repository<AgentEvalResult>,
    private readonly cases: GuideEvalCaseService,
    private readonly releases: AgentReleaseService,
    private readonly playground: GuidePlaygroundService,
    private readonly windows: GuideWindowService,
    private readonly admin: GuideAdminService,
  ) {}

  /** The smoke suite, or a stand-in drawn across the hard categories. */
  async smokeCases(): Promise<AgentEvalCase[]> {
    const smoke = await this.cases.activeCases(SUITE_KEYS.SMOKE);
    if (smoke.length) return smoke.slice(0, SMOKE_MAX_CASES);
    const all = await this.cases.activeCases();
    const picked: AgentEvalCase[] = [];
    for (const category of RED_TEAM_CATEGORY_IDS) {
      picked.push(...all.filter((c) => c.category === category).slice(0, 2));
    }
    for (const c of all) {
      if (picked.length >= SMOKE_MAX_CASES) break;
      if (!picked.includes(c)) picked.push(c);
    }
    return picked.slice(0, SMOKE_MAX_CASES);
  }

  async start(
    releaseId: string,
    input: {
      kind: AgentEvalRunKind;
      repetitions?: number;
      targetCaseIds?: string[];
    },
    userId: number | null,
  ): Promise<AgentEvalRun> {
    const release = await this.releases.getById(releaseId);
    if (release.agentKey !== ALLY_GUIDE_AGENT_KEY) {
      throw new BadRequestException('Not an Ally release');
    }
    const running = await this.runs.findOne({
      where: { releaseId, status: AgentEvalRunStatus.RUNNING },
    });
    if (running) {
      throw new ConflictException(
        'An eval run is already running for this release',
      );
    }
    const policy = evaluatorPolicy(
      (release.bundle as unknown as GuideReleaseBundle).policy,
    );
    const gate = input.kind === AgentEvalRunKind.GATE;
    const caseRows = gate
      ? await this.cases.activeCases()
      : await this.smokeCases();
    if (!caseRows.length) {
      throw new ConflictException(
        'No active eval cases yet: save a turn as a case, or accept proposed ones',
      );
    }
    const ga = gate ? await this.releases.getGa(ALLY_GUIDE_AGENT_KEY) : null;
    const repetitions = gate
      ? Math.max(1, Math.min(input.repetitions ?? policy.gateRepetitions, 5))
      : 1;
    const run = await this.runs.save(
      this.runs.create({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        releaseId,
        baselineReleaseId: ga && ga.id !== releaseId ? ga.id : null,
        kind: input.kind,
        status: AgentEvalRunStatus.QUEUED,
        repetitions,
        caseCount: caseRows.length,
        summary: input.targetCaseIds?.length
          ? { targetCaseIds: input.targetCaseIds }
          : {},
        triggeredBy: userId,
      }),
    );
    if (gate) {
      await this.releases.recordEvalRun({
        releaseId,
        runId: run.id,
        phase: 'started',
        userId,
      });
    }
    setImmediate(() => {
      void this.execute(run.id, caseRows).catch((error) =>
        this.logger.error(
          `Eval run ${run.id} crashed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    });
    return run;
  }

  /** Replay every case × repetition × release, then decide. */
  async execute(
    runId: string,
    caseRows?: AgentEvalCase[],
  ): Promise<AgentEvalRun> {
    const run = await this.get(runId);
    const rows =
      caseRows ??
      (run.kind === AgentEvalRunKind.GATE
        ? await this.cases.activeCases()
        : await this.smokeCases());
    await this.runs.update(run.id, {
      status: AgentEvalRunStatus.RUNNING,
      startedAt: new Date(),
    });
    try {
      const crisisTexts = await this.windows.approvedCrisisTexts();
      const keyCache = new Map<string, Promise<QuizKey[]>>();
      const keysFor = (trackId: string) => {
        if (!keyCache.has(trackId)) {
          keyCache.set(trackId, this.windows.quizKeys(trackId, null));
        }
        return keyCache.get(trackId)!;
      };
      const releasesToRun = [run.releaseId, run.baselineReleaseId].filter(
        (id): id is string => Boolean(id),
      );
      const jobs = rows.flatMap((c) =>
        releasesToRun.flatMap((releaseId) =>
          Array.from({ length: run.repetitions }, (_, i) => ({
            evalCase: c,
            releaseId,
            repetition: i + 1,
          })),
        ),
      );
      const outcomes = new Map<string, CaseOutcome>(
        rows.map((c) => [
          c.id,
          {
            caseId: c.id,
            category: c.category,
            safety: c.safety,
            candidate: [],
            baseline: [],
          },
        ]),
      );
      let cost = 0;
      await pool(jobs, REPLAY_CONCURRENCY, async (job) => {
        const replay = await this.replay(job.evalCase, job.releaseId, {
          crisisTexts,
          quizKeys: await keysFor(
            (job.evalCase.input as GuideCaseInput).trackId,
          ),
        });
        cost += replay.costUsd;
        await this.results.save(
          this.results.create({
            runId: run.id,
            caseId: job.evalCase.id,
            releaseId: job.releaseId,
            repetition: job.repetition,
            passed: replay.passed,
            safetyFailed: replay.safetyFailed,
            quality: replay.quality,
            checks: replay.checks
              .filter((check) => check.applicable)
              .map((check) => ({ ...check })),
            output: replay.output,
            error: replay.error,
            latencyMs: replay.latencyMs,
            costUsd: replay.costUsd.toFixed(6),
          }),
        );
        const rep: RepetitionResult = {
          passed: replay.passed,
          safetyFailed: replay.safetyFailed,
          quality: replay.quality,
          errored: Boolean(replay.error),
        };
        const outcome = outcomes.get(job.evalCase.id)!;
        (job.releaseId === run.releaseId
          ? outcome.candidate
          : outcome.baseline
        ).push(rep);
      });

      const guard = await this.guardFor(run.releaseId);
      const decision = decideGate({
        outcomes: [...outcomes.values()],
        withBaseline: Boolean(run.baselineReleaseId),
        guard,
        targetCaseIds: run.summary?.targetCaseIds,
      });
      const status = decision.passed
        ? AgentEvalRunStatus.PASSED
        : AgentEvalRunStatus.FAILED;
      await this.runs.update(run.id, {
        status,
        completedAt: new Date(),
        costUsd: cost.toFixed(6),
        summary: jsonb({
          ...(run.summary ?? {}),
          decision,
          byCategory: byCategory([...outcomes.values()]),
        }),
      });
      if (run.kind === AgentEvalRunKind.GATE) {
        await this.releases.recordEvalRun({
          releaseId: run.releaseId,
          runId: run.id,
          phase: decision.passed ? 'passed' : 'failed',
          userId: run.triggeredBy ?? null,
          detail: {
            reasons: decision.reasons,
            safetyFailures: decision.safetyFailures,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Eval run ${run.id} failed: ${message}`);
      await this.runs.update(run.id, {
        status: AgentEvalRunStatus.ERROR,
        completedAt: new Date(),
        summary: jsonb({
          ...(run.summary ?? {}),
          error: message.slice(0, 500),
        }),
      });
      if (run.kind === AgentEvalRunKind.GATE) {
        await this.releases
          .recordEvalRun({
            releaseId: run.releaseId,
            runId: run.id,
            phase: 'failed',
            userId: run.triggeredBy ?? null,
            detail: { error: message.slice(0, 200) },
          })
          .catch(() => undefined);
      }
    }
    return this.get(run.id);
  }

  /** One dry-run turn of a case on a release, checked. Never throws. */
  async replay(
    evalCase: Pick<AgentEvalCase, 'input' | 'expectations' | 'safety'>,
    releaseId: string,
    ctx: { crisisTexts: string[]; quizKeys: QuizKey[] },
  ): Promise<ReplayResult> {
    const input = evalCase.input as GuideCaseInput;
    try {
      const output = await this.playground.run({
        ...(input as Omit<PlaygroundInput, 'releaseId'>),
        releaseId,
        costAgentKey: GUIDE_LEARNING_COST_KEY,
      });
      const situation = readSituation(output.situation);
      const window: EvalWindow = {
        reply: { text: output.reply ?? '', kind: output.replyKind },
        channel: input.channel ?? 'text',
        learnerText: input.message,
        recent: (input.history ?? []).slice(-6),
        mode:
          output.replyKind === 'crisis' ? 'CRISIS' : (input.mode ?? 'NORMAL'),
        sentinel: output.sentinel
          ? {
              risk: output.sentinel.risk,
              about: output.sentinel.about,
              overlay: output.sentinel.overlay,
            }
          : null,
        budget: situation.budget,
        releaseWindowOpen: situation.releaseWindowOpen,
        toolCalls: output.toolCalls.map((call) => ({
          name: call.name,
          input: call.input,
        })),
        quizKeys: ctx.quizKeys,
        approvedCrisisTexts: ctx.crisisTexts,
        praiseEveryTurns: 4,
      };
      const checks = [
        ...runDeterministicChecks(window),
        ...checkExpectations(
          {
            reply: window.reply.text,
            replyKind: output.replyKind,
            toolCalls: window.toolCalls,
          },
          (evalCase.expectations ?? {}) as GuideCaseExpectations,
          evalCase.safety,
        ),
      ];
      return {
        checks,
        passed: failedChecks(checks).length === 0,
        safetyFailed: hasSafetyFailure(checks),
        quality: qualityScore(checks),
        output: {
          reply: redactText(output.reply ?? ''),
          replyKind: output.replyKind,
          model: output.model,
          tools: output.toolCalls.map((call) => ({
            name: call.name,
            reason: (call.input?.reason as string | undefined) ?? null,
            isError: call.isError,
          })),
          sentinel: output.sentinel
            ? {
                risk: output.sentinel.risk,
                about: output.sentinel.about,
                overlay: output.sentinel.overlay,
                source: output.sentinel.source,
              }
            : null,
        },
        error: null,
        latencyMs: output.latencyMs,
        costUsd: output.costUsd ?? 0,
      };
    } catch (error) {
      return {
        checks: [],
        passed: false,
        safetyFailed: false,
        quality: 0,
        output: null,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          500,
        ),
        latencyMs: null,
        costUsd: 0,
      };
    }
  }

  /**
   * The learning-metric guard for a release (plan §4.13): read from its
   * canary arm against GA when it is the running canary, else pending.
   */
  async guardFor(releaseId: string): Promise<GuardResult> {
    const canary = await this.releases.getCanary(ALLY_GUIDE_AGENT_KEY);
    if (!canary || canary.id !== releaseId) {
      return learningGuard(null, null);
    }
    const arms = (await this.admin.armMetrics(
      GUARD_WINDOW_DAYS,
      canary.id,
    )) as ArmLearningMetrics[];
    return learningGuard(
      arms.find((arm) => arm.arm === 'ga') ?? null,
      arms.find((arm) => arm.arm === 'canary') ?? null,
    );
  }

  async get(id: string): Promise<AgentEvalRun> {
    const run = await this.runs.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!run) throw new NotFoundException('Eval run not found');
    return run;
  }

  list(releaseId?: string, limit = 50) {
    return this.runs.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        ...(releaseId ? { releaseId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** Per-result rows. `withOutput` adds the replayed reply (transcripts permission). */
  async listResults(runId: string, withOutput: boolean) {
    await this.get(runId);
    const rows = await this.results.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      releaseId: row.releaseId,
      repetition: row.repetition,
      passed: row.passed,
      safetyFailed: row.safetyFailed,
      quality: row.quality,
      failedChecks: (row.checks ?? [])
        .filter((check) => check.applicable && !check.passed)
        .map((check) => ({
          id: check.id,
          severity: check.severity,
          detail: check.detail,
        })),
      error: row.error,
      latencyMs: row.latencyMs,
      costUsd: Number(row.costUsd),
      ...(withOutput ? { output: row.output } : {}),
    }));
  }
}

function byCategory(outcomes: CaseOutcome[]) {
  const out: Record<
    string,
    { cases: number; candidatePassed: number; baselinePassed: number }
  > = {};
  const majority = (reps: RepetitionResult[]) =>
    reps.length > 0 && reps.filter((r) => r.passed).length * 2 > reps.length;
  for (const outcome of outcomes) {
    const row = (out[outcome.category] ??= {
      cases: 0,
      candidatePassed: 0,
      baselinePassed: 0,
    });
    row.cases++;
    if (majority(outcome.candidate)) row.candidatePassed++;
    if (majority(outcome.baseline)) row.baselinePassed++;
  }
  return out;
}
