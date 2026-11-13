import { ADVISORY_CHECKS, DebriefCheckCode } from '../util/debrief-cards.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { runWithConcurrency } from '../../analytics/util/judge-concurrency.util';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import {
  AgentReleaseAuditAction,
  AgentReleaseAuthorKind,
} from '../../llm-agent/harness/enum/harness.enum';
import { PromptVersioningService } from '../../prompt/service/prompt-versioning.service';
import { PromptVersionSource } from '../../prompt/entity/prompt-version.entity';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_PROMPT_CODES,
  DebriefBundle,
  DebriefRecipeKey,
  DebriefStep,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { PM_HOLD_DAYS } from '../util/debrief-outcome.util';
import {
  changeEvidenceRefusal,
  introducedInstructionPattern,
} from '../util/debrief-pm-agent-rules.util';
import {
  metricValues,
  MetricsViewLike,
} from '../util/debrief-metric-failures.util';
import { DebriefRunArm, DebriefRunMode } from '../enum/debrief-run.enum';
import { createHash, randomUUID } from 'crypto';
import {
  approvalState,
  PINNED_RULE_CODES,
  PINNED_RULE_PROMPTS,
} from '../util/debrief-console-view.util';
import {
  firstVersionHash,
  firstVersionTitle,
  PASSAGE_PROBLEM_MESSAGE,
  passageProblem,
  pinnedRuleActions,
  pinnedRuleName,
  textAfterChange,
} from '../util/debrief-pinned-rules.util';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefAutonomyService } from './debrief-autonomy.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefMetricsService } from './debrief-metrics.service';
import {
  GateResult,
  GateSafetyRecall,
  gateResult,
  isLearnerVisible,
  LadderPair,
  SAFETY_RECALL_REPS,
  quickTestResult,
} from '../util/debrief-ladder.util';
import { DebriefSettingsService } from './debrief-settings.service';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefRunnerService, RunOptions } from './debrief-runner.service';
import { DebriefGraphClient } from './debrief-graph.client';
import {
  DebriefTestSet,
  DebriefTestSetsService,
} from './debrief-test-sets.service';

/** Sessions screened at once; each runs both arms side by side. */
const SCREEN_CONCURRENCY = 3;

/**
 * The PM agent's ladder and approvals (v9 FR-52, D11): ally-be's
 * deterministic half. The thinking is the PM agent Deep Agent in ally-ai
 * (DebriefPmAgentRunService starts it; DebriefPmAgentToolsService enforces its
 * tools). Here: the learning budget, the quick test → gate → (trials and
 * canary in DebriefTrialsService) ladder, a person's approve/reject in the
 * Console (a canary or promotion for route A; filing a Builder session or a
 * bug report for B and C; answering for D), and closing the loop (C5).
 *
 * Built on the agent harness's learning tables: an idea is an
 * `agent_lessons` row (agentKey `debrief`, authorKind `curator`), each run is
 * a `curator_run` row in `agent_lesson_audit` carrying the report and step
 * records, and spend is read from `llm_usage` and the replay runs.
 */
@Injectable()
export class DebriefPmAgentService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = LoggerService.getInstance(
    DebriefPmAgentService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly context: DebriefContextRepository,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly testSets: DebriefTestSetsService,
    private readonly releases: AgentReleaseService,
    private readonly prompts: PromptVersioningService,
    private readonly ownerSettings: DebriefSettingsService,
    private readonly metrics: DebriefMetricsService,
    private readonly moduleRef: ModuleRef,
    /** What may run on its own per kind and step (PRD §12); absent in unit tests. */
    @Optional() private readonly autonomy?: DebriefAutonomyService,
    /** FR-54: the owner hears about promotions, filings and proposals. */
    @Optional() private readonly notifier?: DebriefNotifier,
    /** The gate's safety-recall rule runs the seeded set in ally-ai. Absent → the rule fails closed. */
    @Optional() private readonly graph?: DebriefGraphClient,
  ) {}

  /** The policy for this idea at this step; 'auto' when no policy is wired (tests). */
  private async stepPolicy(
    idea: Record<string, any>,
    step: 'quick_test' | 'gate_test' | 'paired_trial' | 'canary',
  ): Promise<'auto' | 'ask' | 'off'> {
    return this.autonomy ? this.autonomy.forIdea(idea, step) : 'auto';
  }

  onModuleInit(): void {
    // Closing the loop (spec C5): once a promoted idea has stood PM_HOLD_DAYS,
    // record whether the metric it named moved the way it said.
    // When these run is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable(
      'debrief-pm-agent-forecasts',
      () =>
        this.checkForecasts().then(
          (n) => `${n} forecast${n === 1 ? '' : 's'} checked`,
        ),
    );
    // Plan §11.7: an approval unanswered for 14 days expires as "no decision".
    scheduledTaskRegistry.registerConfigurable('debrief-pm-agent-expiry', () =>
      this.expireApprovals().then(
        (n) => `${n} approval${n === 1 ? '' : 's'} expired`,
      ),
    );
  }

  /**
   * At boot, once the Skills Store sync and the release defaults have had
   * time to run: a "Needs you" item for each pinned rule whose version in
   * force has no approval. The PM agent page and Settings › Pinned rules also
   * ask, so a slow boot only delays them.
   */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => {
      this.ensureFirstVersionItems(true).catch((e) =>
        this.logger.warn(
          `[pm-agent] pinned-rule first versions: ${(e as Error).message}`,
        ),
      );
    }, 30_000).unref();
  }

  // --- Learning budget ----------------------------------------------------------

  /**
   * The learning budget this month (v9 FR-58, owner settings FR-60): the
   * fixed monthly amount plus the skim of every production run's ceiling.
   */
  async learningBudgetThisMonth(): Promise<number> {
    const { learningBudgetUsd, learningSkimPct } =
      await this.ownerSettings.get();
    const [r] = await this.dataSource.query(
      `SELECT COALESCE(sum(COALESCE("ceilingUsd", 0)::float), 0) AS ceilings
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND status <> 'skipped'
          AND "createdAt" >= date_trunc('month', now())`,
    );
    return learningBudgetUsd + Number(r?.ceilings ?? 0) * learningSkimPct;
  }

  async learningSpentThisMonth(): Promise<number> {
    const replay = await this.dataSource.query(
      `SELECT COALESCE(sum(COALESCE("actualCostUsd","estimatedCostUsd")),0)::float AS usd
         FROM debrief_runs
        WHERE mode = 'replay' AND "createdAt" >= date_trunc('month', now())`,
    );
    const usage: Array<{ model: string; p: number; c: number }> =
      await this.dataSource.query(
        `SELECT model, sum("promptTokens")::bigint AS p, sum("completionTokens")::bigint AS c
           FROM llm_usage
          WHERE task = 'debrief_improver' AND "occurredAt" >= date_trunc('month', now())
          GROUP BY model`,
      );
    const pmAgent = usage.reduce(
      (n, u) => n + computeCostUsd(u.model, Number(u.p), Number(u.c)).costUsd,
      0,
    );
    // Judging a replay costs about what judging today's debrief does.
    const judged = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM debrief_runs
        WHERE mode = 'replay' AND workspace ? 'judge'
          AND "createdAt" >= date_trunc('month', now())`,
    );
    return Number(replay[0].usd) + pmAgent + Number(judged[0].n) * 0.04;
  }

  // --- Ideas ------------------------------------------------------------------------

  async gaBundle(): Promise<{
    id: string | null;
    bundle: DebriefBundle;
  }> {
    const { release, bundle } = await this.runner.resolveRelease();
    return { id: release?.id ?? null, bundle };
  }

  /** Ideas the PM agent has had, newest first, with what happened to each. */
  async history(limit = 30): Promise<Array<Record<string, any>>> {
    return this.dataSource.query(
      `SELECT l.id, l.status, l.text AS title, l.change, l.evidence, l."createdAt",
              l."decidedBy", l."decidedAt",
              r.version AS "releaseVersion", r.status AS "releaseStatus"
         FROM agent_lessons l
         LEFT JOIN agent_releases r ON r.id = l."releaseId"
        WHERE l."agentKey" = $1
        ORDER BY l."createdAt" DESC
        LIMIT $2`,
      [DEBRIEF_AGENT_KEY, limit],
    );
  }

  async getIdea(id: string): Promise<Record<string, any>> {
    const rows = await this.dataSource.query(
      `SELECT * FROM agent_lessons WHERE id = $1 AND "agentKey" = $2`,
      [id, DEBRIEF_AGENT_KEY],
    );
    if (!rows.length) throw new NotFoundException('Idea not found');
    return rows[0];
  }

  /** The challenger: GA with this idea applied, for one run only. */
  private challengerFor(
    change: Record<string, any>,
    promptTexts: Record<string, string>,
  ): {
    promptOverrides?: Record<string, string>;
    settingOverrides?: Record<string, number>;
    maxRevisionRounds?: number;
  } {
    if (change.ideaKind === 'prompt_edit') {
      const current = promptTexts[change.promptCode];
      if (!current || !current.includes(change.find)) {
        throw new ConflictException(
          'the prompt changed since this idea; its passage is gone',
        );
      }
      return {
        promptOverrides: {
          [change.promptCode]: current.replace(change.find, change.replace),
        },
      };
    }
    if (change.ideaKind === 'setting') {
      const v = Number(change.settingValue);
      if (change.settingKey === 'maxRevisionRounds')
        return { maxRevisionRounds: v };
      return { settingOverrides: { [change.settingKey]: v } };
    }
    throw new BadRequestException(
      'only prompt edits and settings can be screened',
    );
  }

  /**
   * How the challenger runs for an idea: the prompt or setting override, or a
   * whole bundle when the change is a recipe setting. Checked against the
   * catalog before anything is paid for. Used by every rung of the ladder.
   */
  async challengerOptions(
    idea: Record<string, any>,
  ): Promise<Partial<RunOptions>> {
    if (idea.change?.ideaKind === 'release') {
      // A person's proposed change: its whole draft release is the challenger.
      const r = await this.releases.getById(idea.change.releaseId);
      return {
        release: { id: r.id, version: r.version, bundle: r.bundle } as any,
      };
    }
    const { bundle } = await this.gaBundle();
    const code = idea.change?.promptCode;
    const promptTexts: Record<string, string> = {};
    if (code) {
      const text = await this.context.promptText(
        code,
        bundle.prompts[code] ?? null,
      );
      if (text) promptTexts[code] = text;
    }
    const challenger = this.challengerFor(idea.change, promptTexts);
    const challengerBundle =
      challenger.maxRevisionRounds != null
        ? {
            ...bundle,
            recipes: {
              ...bundle.recipes,
              [DebriefRecipeKey.STANDARD]: {
                ...bundle.recipes[DebriefRecipeKey.STANDARD],
                maxRevisionRounds: challenger.maxRevisionRounds,
              },
            },
          }
        : null;
    if (challengerBundle) {
      const problems = validateDebriefBundle(
        challengerBundle,
        await this.runner.modelCatalog(),
      );
      if (problems.length) throw new BadRequestException(problems.join('; '));
    }
    return {
      promptOverrides: challenger.promptOverrides,
      settingOverrides: challenger.settingOverrides,
      release: challengerBundle
        ? ({ id: null, version: null, bundle: challengerBundle } as any)
        : undefined,
    };
  }

  /** Throws when this month's learning budget is spent. */
  private async requireLearningBudget(): Promise<void> {
    if (
      (await this.learningSpentThisMonth()) >=
      (await this.learningBudgetThisMonth())
    ) {
      throw new ConflictException(
        'the learning budget for this month is spent',
      );
    }
  }

  /**
   * Rung 1, the quick test (v9 FR-52): the current release and the challenger
   * on the same open-set sessions (owner setting `quickTestCases`), judged
   * blind by the independent judge. Passing starts rung 2, the full gate test,
   * on its own. Paid from the learning budget.
   *
   * Checks everything that can be checked up front, marks the idea's quick
   * test as running and returns; the runs take minutes, so they finish in the
   * background and write the result onto the idea.
   */
  async screen(
    ideaId: string,
  ): Promise<{ status: 'running'; startedAt: string }> {
    const idea = await this.getIdea(ideaId);
    const running = idea.evidence?.screen;
    if (
      running?.status === 'running' &&
      Date.now() - new Date(running.startedAt).getTime() < 60 * 60 * 1000
    ) {
      throw new ConflictException('this idea is already being tried');
    }
    if ((await this.stepPolicy(idea, 'quick_test')) === 'off') {
      throw new ConflictException(
        'quick checks are off for this kind of change',
      );
    }
    await this.requireLearningBudget();
    const challenger = await this.challengerOptions(idea);
    const settings = await this.ownerSettings.get();
    const sessions = await this.testSets.sessions(
      DebriefTestSet.OPEN,
      settings.quickTestCases,
    );
    if (sessions.length === 0) {
      throw new ConflictException(
        'there are no practice sessions yet; add recent sessions to the test sets first',
      );
    }
    const startedAt = new Date().toISOString();
    await this.writeEvidence(ideaId, 'screen', {
      status: 'running',
      startedAt,
    });
    void (async () => {
      const pairs = await this.runPairs(ideaId, sessions, challenger);
      const result = quickTestResult(pairs, sessions.length, settings);
      await this.writeEvidence(ideaId, 'screen', result);
      await this.audit('pipeline_step', ideaId, null, {
        step: 'quick_test',
        ...result,
      });
      if (result.passed) await this.nextStep(idea, 'gate_test');
    })().catch(async (e) => {
      this.logger.error(
        `[pm-agent] quick test ${ideaId} failed: ${(e as Error).message}`,
      );
      await this.writeEvidence(ideaId, 'screen', {
        status: 'failed',
        startedAt,
        error: (e as Error).message.slice(0, 300),
      }).catch(() => undefined);
    });
    return { status: 'running', startedAt };
  }

  /**
   * Rung 2, the full gate test (v9 FR-52): the gate set (owner setting
   * `gateCases`, rotated monthly), and the owner's gate rules — no new hard
   * fails, the judge's median not lower, cost within the allowed increase.
   * Passing starts rung 3, the paired trial on production sessions.
   */
  async gate(ideaId: string): Promise<GateResult | null> {
    const idea = await this.getIdea(ideaId);
    const settings = await this.ownerSettings.get();
    const startedAt = new Date().toISOString();
    try {
      await this.requireLearningBudget();
      const sessions = await this.testSets.sessions(
        DebriefTestSet.GATE,
        settings.gateCases,
      );
      if (sessions.length === 0) {
        throw new ConflictException('there are no test sessions yet');
      }
      await this.writeEvidence(ideaId, 'gate', {
        status: 'running',
        startedAt,
      });
      const challenger = await this.challengerOptions(idea);
      const [pairs, safety] = await Promise.all([
        this.runPairs(ideaId, sessions, challenger),
        this.safetyRecall(challenger),
      ]);
      const result = gateResult(pairs, sessions.length, settings, safety);
      await this.writeEvidence(ideaId, 'gate', result);
      await this.audit('pipeline_step', ideaId, null, {
        step: 'gate',
        ...result,
      });
      if (result.passed) await this.nextStep(idea, 'paired_trial');
      return result;
    } catch (e) {
      this.logger.error(
        `[pm-agent] gate ${ideaId} failed: ${(e as Error).message}`,
      );
      await this.writeEvidence(ideaId, 'gate', {
        status: 'failed',
        startedAt,
        error: (e as Error).message.slice(0, 300),
      }).catch(() => undefined);
      return null;
    }
  }

  /**
   * The gate's hard rule (plan §9, PRD §12): the challenger's Safety reader —
   * the model its release names for the step and its system prompt, with
   * this idea's edit applied — on the seeded safety set, three times. Any
   * failure to run it reads as a failed rule, never a pass.
   */
  async safetyRecall(
    challenger: Partial<RunOptions>,
  ): Promise<GateSafetyRecall | null> {
    const code = DEBRIEF_PROMPT_CODES.safetyReader;
    try {
      if (!this.graph) throw new Error('ally-ai is not wired');
      const bundle =
        (challenger.release as { bundle?: DebriefBundle } | undefined)
          ?.bundle ?? (await this.gaBundle()).bundle;
      const step = bundle.recipes[DebriefRecipeKey.STANDARD]?.steps.find(
        (x) => x.step === DebriefStep.SAFETY_READER,
      );
      const system =
        challenger.promptOverrides?.[code] ??
        (await this.context.promptText(code, bundle.prompts?.[code] ?? null));
      const r = await this.graph.safetyRecall({
        model: step?.model ?? null,
        system,
        reps: SAFETY_RECALL_REPS,
      });
      return {
        passed: r.passed,
        reps: r.reps.map((x) => ({
          rep: x.rep,
          recall: x.recall,
          missed: x.missed,
        })),
        cases: r.cases,
        planted: r.planted,
        model: step?.model ?? null,
        ranAt: new Date().toISOString(),
      };
    } catch (e) {
      this.logger.warn(
        `[pm-agent] safety recall could not run: ${(e as Error).message}`,
      );
      return {
        passed: false,
        reps: [],
        error: (e as Error).message.slice(0, 300),
      };
    }
  }

  /** Baseline and challenger on each session, judged blind; a failed arm is "no score", never zero. */
  private async runPairs(
    ideaId: string,
    sessions: string[],
    challengerOpts: Partial<RunOptions>,
  ): Promise<LadderPair[]> {
    const pairs: LadderPair[] = [];
    const runArm = async (
      sessionId: string,
      arm: DebriefRunArm,
      opts: Partial<RunOptions>,
    ) => {
      const run = await this.runner.run(sessionId, {
        mode: DebriefRunMode.REPLAY,
        experimentId: ideaId,
        arm,
        ...opts,
      });
      const judged = run.cards
        ? await this.judge.judge(run).catch(() => null)
        : null;
      return { run, judged };
    };
    await runWithConcurrency(
      sessions,
      SCREEN_CONCURRENCY,
      async (sessionId) => {
        const [b, c] = await Promise.all([
          runArm(sessionId, DebriefRunArm.BASELINE, {}),
          runArm(sessionId, DebriefRunArm.CHALLENGER, challengerOpts),
        ]);
        pairs.push({
          base: b.judged,
          chal: c.judged,
          chalChecks: c.run.checkFailures.filter(
            (f) => !ADVISORY_CHECKS.has(f.code as DebriefCheckCode),
          ).length,
          baseCost: Number(b.run.estimatedCostUsd),
          chalCost: Number(c.run.estimatedCostUsd),
        });
      },
    );
    return pairs;
  }

  /**
   * A rung passed: start the next one on its own when the policy says
   * "auto", leave it waiting for a person on "ask", stop on "off".
   */
  private async nextStep(
    idea: Record<string, any>,
    step: 'gate_test' | 'paired_trial',
  ): Promise<void> {
    const policy = await this.stepPolicy(idea, step);
    const key = step === 'gate_test' ? 'gate' : 'trial';
    if (policy === 'auto') {
      if (step === 'gate_test') await this.gate(idea.id);
      else await this.startTrial(idea.id);
      return;
    }
    await this.writeEvidence(idea.id, key, {
      status: policy === 'ask' ? 'waiting' : 'off',
      at: new Date().toISOString(),
    });
  }

  private async startTrial(ideaId: string): Promise<void> {
    await this.writeEvidence(ideaId, 'trial', {
      status: 'running',
      startedAt: new Date().toISOString(),
      comparisons: 0,
    });
  }

  /**
   * A person starts a step the policy left waiting ("ask"): the gate test
   * after a passed quick test, or the paired trial after a passed gate.
   */
  async startStep(
    ideaId: string,
    step: 'gate_test' | 'paired_trial',
    userId: number,
  ): Promise<{ step: string; status: 'running' }> {
    const idea = await this.getIdea(ideaId);
    if ((await this.stepPolicy(idea, step)) === 'off') {
      throw new ConflictException(
        `${step === 'gate_test' ? 'pass tests' : 'side-by-side trials'} are off while the PM agent is switched off`,
      );
    }
    if (step === 'gate_test') {
      if (idea.evidence?.screen?.passed !== true) {
        throw new ConflictException('the quick check has not passed');
      }
      if (idea.evidence?.gate?.status === 'running') {
        throw new ConflictException('the pass test is already running');
      }
      void this.gate(ideaId);
    } else {
      if (idea.evidence?.gate?.passed !== true) {
        throw new ConflictException('the pass test has not passed');
      }
      if (idea.evidence?.trial?.status === 'running') {
        throw new ConflictException(
          'the side-by-side trial is already running',
        );
      }
      await this.startTrial(ideaId);
    }
    await this.audit('pipeline_step', ideaId, userId, {
      step: `${step}_started`,
    });
    return { step, status: 'running' };
  }

  /** Merge one rung's result into the idea's evidence. */
  async writeEvidence(
    ideaId: string,
    key:
      | 'screen'
      | 'gate'
      | 'trial'
      | 'canary'
      | 'draft'
      | 'handoff'
      | 'forecast'
      | 'expiry'
      | 'expiryWarning'
      | 'signoff'
      | 'withdrawn'
      | 'rejection',
    value: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE agent_lessons SET evidence = evidence || jsonb_build_object($2::text, $3::jsonb),
              "updatedAt" = now()
        WHERE id = $1::uuid`,
      [ideaId, key, JSON.stringify(value)],
    );
  }

  /**
   * A person approves. Route A: the change becomes a new release and goes GA
   * through the ladder. A prompt edit is written to the Skills Store as a new
   * version (never made the store's current version — the release pins it),
   * so rollback restores the previous release and every version it named.
   * Routes B, C and D: see `approveHandoff`.
   */
  async approve(
    ideaId: string,
    userId: number,
    note?: string,
  ): Promise<
    | { releaseId: string; version: number; stage: 'canary' | 'promoted' }
    | { stage: 'builder' | 'bug_hunter' | 'answered'; id: string | null }
  > {
    const idea = await this.getIdea(ideaId);
    if (!['proposed', 'approved'].includes(idea.status)) {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    if (approvalState(idea as any)?.expired) {
      throw new ConflictException(
        'this approval expired after 14 days with no decision',
      );
    }
    const kind = idea.change?.ideaKind;
    if (kind === 'pinned_rule') {
      throw new BadRequestException(
        'a pinned-rule change is approved by the clinical advisor or the owner (approvePinnedRule)',
      );
    }
    if (['needs_code', 'defect', 'needs_person'].includes(kind)) {
      return this.approveHandoff(idea, userId, note);
    }
    if (kind === 'release' && idea.change?.budgetOnly) {
      return this.promoteBudgetChange(idea, userId, note);
    }
    if (kind !== 'prompt_edit' && kind !== 'setting' && kind !== 'release') {
      throw new BadRequestException(
        kind === 'registry_agent'
          ? 'registry agents wait for the agent registry (spec step 7)'
          : 'this idea has no drafted change yet',
      );
    }
    // R2-18 (FR-56): the PM agent's own prompt edit reaches learners only
    // with the content-safety record release_draft wrote; checked again here
    // so a draft from before the checks (or edited since) can't slip through.
    if (kind === 'prompt_edit' && idea.authorKind === 'curator') {
      const problem = selfMadeEditProblem(idea);
      if (problem) throw new ConflictException(problem);
    }
    // The ladder holds (v9 FR-52): a canary that passed is promoted; a paired
    // trial that passed starts a canary; nothing else may reach learners.
    const canary = idea.evidence?.canary;
    if (canary?.status === 'passed' && canary.releaseId) {
      const released = await this.releases.makeGa(
        canary.releaseId,
        userId,
        AgentReleaseAuditAction.PROMOTED,
        note,
      );
      await this.dataSource.query(
        `UPDATE agent_lessons SET status = 'active', "releaseId" = $2, "updatedAt" = now() WHERE id = $1`,
        [ideaId, canary.releaseId],
      );
      await this.writeEvidence(ideaId, 'canary', {
        ...canary,
        status: 'promoted',
        promotedAt: new Date().toISOString(),
      });
      await this.audit('activated', ideaId, userId, {
        releaseId: canary.releaseId,
        note: note ?? null,
      });
      await this.notifier?.owner({
        title: `Debriefs: v${(released as { version?: number })?.version ?? canary.version} is live for everyone`,
        body: `Put live for everyone from the idea “${idea.text}”.${note ? ` ${note}` : ''}`,
        data: { ideaId, releaseId: canary.releaseId },
        excludeUserId: userId,
      });
      return {
        releaseId: canary.releaseId,
        version: (released as { version?: number })?.version ?? canary.version,
        stage: 'promoted',
      };
    }
    if (canary?.status === 'running') {
      throw new ConflictException('the learner try-out is still running');
    }
    if (idea.evidence?.trial?.status !== 'passed') {
      throw new ConflictException(
        'only a change that passed its side-by-side trial on real sessions can be tried on learners',
      );
    }
    // Spec §4: the canary is only for changes learners can see; anything
    // else is promoted once its paired trial passed.
    const visible = isLearnerVisible(idea.change);
    if (visible && (await this.stepPolicy(idea, 'canary')) === 'off') {
      throw new ConflictException(
        'learner try-outs are off for this kind of change',
      );
    }
    if (kind === 'release') {
      // A person's proposed change already carries its draft release.
      const draftRelease = await this.releases.getById(idea.change.releaseId);
      return visible
        ? this.startCanaryFor(idea, draftRelease, userId, note)
        : this.promoteWithoutCanary(idea, draftRelease, userId, note);
    }
    const { bundle } = await this.gaBundle();
    const next: DebriefBundle = JSON.parse(JSON.stringify(bundle));
    if (kind === 'prompt_edit') {
      const code = idea.change.promptCode as string;
      const current = await this.context.promptText(
        code,
        bundle.prompts[code] ?? null,
      );
      if (!current || !current.includes(idea.change.find)) {
        throw new ConflictException(
          'the prompt changed since this idea; its passage is gone',
        );
      }
      const [prompt] = await this.dataSource.query(
        `SELECT id FROM prompts WHERE "promptCode" = $1`,
        [code],
      );
      if (!prompt)
        throw new NotFoundException(
          `prompt ${code} is not in the Skills Store`,
        );
      const latest = await this.prompts.latestVersionOf(prompt.id);
      const version = await this.prompts.createVersion(
        prompt.id,
        {
          body: current.replace(idea.change.find, idea.change.replace),
          baseVersion: latest,
          source: PromptVersionSource.EXPERIMENT,
          note: `Debrief PM agent idea ${ideaId}: ${idea.text}`.slice(0, 500),
          evalSummary: idea.evidence?.screen ?? null,
          createdBy: userId,
        },
        { translate: 'none' },
      );
      next.prompts[code] = version.version;
    } else {
      const key = idea.change.settingKey as string;
      const v = Number(idea.change.settingValue);
      if (key === 'maxRevisionRounds') {
        next.recipes[DebriefRecipeKey.STANDARD].maxRevisionRounds = v;
      } else {
        (next.settings as unknown as Record<string, number>)[key] = v;
      }
    }
    const problems = validateDebriefBundle(
      next,
      await this.runner.modelCatalog(),
    );
    if (problems.length) throw new BadRequestException(problems.join('; '));
    // Rung 4 (v9 FR-52): the candidate release reaches a share of real
    // learners in switched-on organisations first; DebriefTrialsService
    // reverts it on its own when it does worse, or marks it ready to promote.
    const draft = await this.releases.createDraft(
      DEBRIEF_AGENT_KEY,
      next as unknown as Record<string, unknown>,
      userId,
      `PM agent idea (learner try-out): ${idea.text}`,
    );
    // Plan §8.8: the exact prompt versions it runs, recorded now.
    await this.runner.pinPrompts(draft);
    return visible
      ? this.startCanaryFor(idea, draft, userId, note)
      : this.promoteWithoutCanary(idea, draft, userId, note);
  }

  /**
   * Spec §4: a change learners can't see (isLearnerVisible) skips the canary.
   * Its paired trial passed, so a person's approval makes it the release in
   * force; the canary evidence says why there was none.
   */
  private async promoteWithoutCanary(
    idea: Record<string, any>,
    draft: { id: string; version: number },
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number; stage: 'promoted' }> {
    const ideaId = idea.id as string;
    const released = await this.releases.makeGa(
      draft.id,
      userId,
      AgentReleaseAuditAction.PROMOTED,
      note,
    );
    const version =
      (released as { version?: number })?.version ?? draft.version;
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'active', "releaseId" = $2, "updatedAt" = now() WHERE id = $1`,
      [ideaId, draft.id],
    );
    await this.writeEvidence(ideaId, 'canary', {
      status: 'skipped',
      reason: 'not learner-visible',
      releaseId: draft.id,
      version,
      promotedAt: new Date().toISOString(),
    });
    await this.audit('activated', ideaId, userId, {
      releaseId: draft.id,
      canary: 'skipped: not learner-visible',
      note: note ?? null,
    });
    await this.notifier?.owner({
      title: `Debriefs: v${version} is live for everyone`,
      body: `Put live for everyone from the idea “${idea.text}” without a learner try-out: learners don't see this change.${note ? ` ${note}` : ''}`,
      data: { ideaId, releaseId: draft.id },
      excludeUserId: userId,
    });
    return { releaseId: draft.id, version, stage: 'promoted' };
  }

  /** Rung 4: the candidate release reaches a share of live learners; the canary watcher decides. */
  private async startCanaryFor(
    idea: Record<string, any>,
    draft: { id: string; version: number },
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number; stage: 'canary' }> {
    const ideaId = idea.id as string;
    const { canaryShare } = await this.ownerSettings.get();
    // The harness's canary (one per agent, audited, at most 30%).
    await this.releases.startCanary(
      draft.id,
      Math.max(1, Math.round(canaryShare * 100)),
      userId,
      `PM agent idea ${ideaId}: ${idea.text}`.slice(0, 300),
    );
    await this.writeEvidence(ideaId, 'canary', {
      status: 'running',
      releaseId: draft.id,
      version: draft.version,
      share: canaryShare,
      startedAt: new Date().toISOString(),
      startedBy: userId,
    });
    await this.audit('pipeline_step', ideaId, userId, {
      step: 'canary_started',
      releaseId: draft.id,
      version: draft.version,
      share: canaryShare,
      note: note ?? null,
    });
    return { releaseId: draft.id, version: draft.version, stage: 'canary' };
  }

  /**
   * A proposed change that touches only budget settings (the run ceiling,
   * the monthly cap): it does not change what learners read, so it skips the
   * ladder and goes live when the owner approves it (the controller checks
   * the owner permission).
   */
  private async promoteBudgetChange(
    idea: Record<string, any>,
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number; stage: 'promoted' }> {
    const released = await this.releases.makeGa(
      idea.change.releaseId,
      userId,
      AgentReleaseAuditAction.PROMOTED,
      note,
    );
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'active', "releaseId" = $2, "decidedBy" = $3,
              "decidedAt" = now(), "updatedAt" = now() WHERE id = $1`,
      [idea.id, idea.change.releaseId, userId],
    );
    await this.audit('activated', idea.id, userId, {
      releaseId: idea.change.releaseId,
      budgetOnly: true,
      note: note ?? null,
    });
    await this.notifier?.owner({
      title: `Debriefs: v${released.version} is live (budgets)`,
      body: `${idea.text}${note ? ` — ${note}` : ''}`,
      data: { ideaId: idea.id, releaseId: idea.change.releaseId },
      excludeUserId: userId,
    });
    return {
      releaseId: idea.change.releaseId,
      version: released.version,
      stage: 'promoted',
    };
  }

  /**
   * Routes B, C and D, approved by a person (spec C3, FR-63): Builder gets a
   * session whose hand-off context is the agent's brief (quotes already
   * stripped by the gateway), Bug Hunter a reported bug with the summary and
   * run ids, a person's question is marked answered. The approver is the
   * actor, so the Builder session and the bug report carry a real person.
   * Resolved lazily (ModuleRef): Builder and the roadmap import far more than
   * the debrief needs, and the debrief is imported by modules they reach.
   */
  async approveHandoff(
    idea: Record<string, any>,
    userId: number,
    note?: string,
  ): Promise<{
    stage: 'builder' | 'bug_hunter' | 'answered';
    id: string | null;
  }> {
    const h = idea.evidence?.handoff;
    const kind = idea.change?.ideaKind;
    if (!h || h.status !== 'waiting') {
      throw new ConflictException(
        'the PM agent has not written its hand-off yet',
      );
    }
    let stage: 'builder' | 'bug_hunter' | 'answered' = 'answered';
    let id: string | null = null;
    if (kind === 'needs_code') {
      const { BuilderSessionService } =
        await import('../../builder/service/builder-session.service');
      const builder = this.moduleRef.get(BuilderSessionService, {
        strict: false,
      });
      const session = await builder.createSession(userId, {
        title: String(idea.text).slice(0, 120),
        handoffContext: builderHandoffText(idea),
      });
      stage = 'builder';
      id = session.id;
    } else if (kind === 'defect') {
      const { RoadmapOpportunityService } =
        await import('../../product-roadmap/service/roadmap-opportunity.service');
      const roadmap = this.moduleRef.get(RoadmapOpportunityService, {
        strict: false,
      });
      const created = await roadmap.createBugReport(userId, null, {
        description: bugReportText(idea).slice(0, 1000),
        ...(h.repo ? { repo: h.repo } : {}),
      } as any);
      stage = 'bug_hunter';
      id = created.id;
    }
    await this.writeEvidence(idea.id, 'handoff', {
      ...h,
      status: stage === 'answered' ? 'answered' : 'filed',
      filedId: id,
      decidedBy: userId,
      decidedAt: new Date().toISOString(),
      note: note ?? null,
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'approved', "decidedBy" = $2, "decidedAt" = now(),
              "updatedAt" = now() WHERE id = $1`,
      [idea.id, userId],
    );
    await this.audit('approved', idea.id, userId, {
      stage,
      id,
      note: note ?? null,
    });
    if (stage !== 'answered') {
      await this.notifier?.owner({
        title:
          stage === 'builder'
            ? 'Debriefs: a Builder session was filed'
            : 'Debriefs: a bug was filed for Bug Hunter',
        body: `From PM agent idea “${idea.text}”.`,
        data: { ideaId: idea.id, filedId: id },
        excludeUserId: userId,
      });
    }
    return { stage, id };
  }

  // --- Approvals: questions, expiry, pinned rules (plan §11.7) ----------------------

  /**
   * "Ask a question" on an item waiting for approval: a thread on the idea,
   * kept in its evidence. The PM agent reads open questions on its next run
   * (run context `open_questions`). Asking does not stop the 14-day clock.
   */
  async askQuestion(
    ideaId: string,
    userId: number,
    text: string,
  ): Promise<{ id: string; at: string }> {
    const idea = await this.getIdea(ideaId);
    if (['rejected', 'retired'].includes(idea.status)) {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    const body = (text ?? '').trim();
    if (!body) throw new BadRequestException('Write the question first');
    const entry = {
      id: randomUUID(),
      role: 'person',
      by: userId,
      at: new Date().toISOString(),
      text: body.slice(0, 2000),
    };
    await this.dataSource.query(
      `UPDATE agent_lessons
          SET evidence = jsonb_set(coalesce(evidence, '{}'::jsonb), '{questions}',
                coalesce(evidence->'questions', '[]'::jsonb) || jsonb_build_array($2::jsonb)),
              "updatedAt" = now()
        WHERE id = $1::uuid`,
      [ideaId, JSON.stringify(entry)],
    );
    await this.audit('pipeline_step', ideaId, userId, {
      step: 'question',
      questionId: entry.id,
    });
    return { id: entry.id, at: entry.at };
  }

  /** Questions people asked that the PM agent has not answered, for its run context. */
  async openQuestions(): Promise<
    Array<{
      idea_id: string;
      question_id: string;
      title: string;
      question: string;
      at: string;
    }>
  > {
    const rows: Array<{ id: string; text: string; questions: any[] }> =
      await this.dataSource.query(
        `SELECT id, text, evidence->'questions' AS questions FROM agent_lessons
          WHERE "agentKey" = $1 AND status IN ('proposed','approved')
            AND jsonb_array_length(coalesce(evidence->'questions','[]'::jsonb)) > 0`,
        [DEBRIEF_AGENT_KEY],
      );
    const out: Array<{
      idea_id: string;
      question_id: string;
      title: string;
      question: string;
      at: string;
    }> = [];
    for (const r of rows) {
      const qs = (r.questions ?? []) as Array<{
        id: string;
        role: string;
        text: string;
        at: string;
        replyTo?: string | null;
      }>;
      const answered = new Set(
        qs.filter((q) => q.role === 'agent').map((q) => q.replyTo),
      );
      for (const q of qs) {
        if (q.role === 'person' && !answered.has(q.id)) {
          out.push({
            idea_id: r.id,
            question_id: q.id,
            title: r.text,
            question: q.text,
            at: q.at,
          });
        }
      }
    }
    return out;
  }

  /** The PM agent's answer, added to the idea's question thread. */
  async answerQuestion(
    ideaId: string,
    questionId: string | null,
    answer: string,
    agentRunId: string,
  ): Promise<{ ok: true; id: string }> {
    const idea = await this.getIdea(ideaId);
    const qs = (idea.evidence?.questions ?? []) as Array<{
      id: string;
      role: string;
    }>;
    const target =
      (questionId &&
        qs.find((q) => q.id === questionId && q.role === 'person')) ||
      [...qs].reverse().find((q) => q.role === 'person');
    if (!target) {
      throw new BadRequestException('there is no question on this idea');
    }
    const entry = {
      id: randomUUID(),
      role: 'agent',
      by: null,
      agentRunId,
      replyTo: target.id,
      at: new Date().toISOString(),
      text: answer.slice(0, 1500),
    };
    await this.dataSource.query(
      `UPDATE agent_lessons
          SET evidence = jsonb_set(coalesce(evidence, '{}'::jsonb), '{questions}',
                coalesce(evidence->'questions', '[]'::jsonb) || jsonb_build_array($2::jsonb)),
              "updatedAt" = now()
        WHERE id = $1::uuid`,
      [ideaId, JSON.stringify(entry)],
    );
    await this.audit('pipeline_step', ideaId, null, {
      step: 'question_answered',
      questionId: target.id,
      agentRunId,
    });
    return { ok: true, id: entry.id };
  }

  /**
   * Plan §11.7: items unanswered for 14 days expire as "no decision". The
   * idea is set aside (rejected, with `evidence.expiry`), so it shows under
   * "Not taken forward"; a canary that passed and was never promoted is
   * stopped, back to the release in force.
   */
  async expireApprovals(now = new Date()): Promise<number> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, status, change, evidence, "createdAt" FROM agent_lessons
        WHERE "agentKey" = $1 AND status IN ('proposed','approved')
          AND NOT (coalesce(evidence, '{}'::jsonb) ? 'expiry')`,
      [DEBRIEF_AGENT_KEY],
    );
    let expired = 0;
    for (const idea of rows) {
      const state = approvalState(idea as any, now);
      if (!state?.expired) continue;
      await this.writeEvidence(idea.id, 'expiry', {
        at: now.toISOString(),
        reason: 'no_decision',
        wait: state.wait,
        since: state.since,
      });
      await this.dataSource.query(
        `UPDATE agent_lessons SET status = 'rejected', "updatedAt" = now() WHERE id = $1`,
        [idea.id],
      );
      await this.audit('rejected', idea.id, null, {
        reason: 'expired_no_decision',
        wait: state.wait,
      });
      if (state.wait === 'promote') {
        await this.releases
          .stopCanary(
            DEBRIEF_AGENT_KEY,
            null,
            false,
            'approval expired with no decision',
            {
              actorKind: AgentReleaseAuthorKind.SYSTEM,
              action: AgentReleaseAuditAction.CANARY_STOPPED,
              detail: { ideaId: idea.id },
            },
          )
          .catch((e) =>
            this.logger.warn(
              `[pm-agent] could not stop the canary of expired idea ${idea.id}: ${(e as Error).message}`,
            ),
          );
      }
      expired++;
    }
    return expired;
  }

  /**
   * A pinned-rule proposal (plan §11.7 "always a person"): a change to the
   * safety rules, the rubric or the judge's instructions, written as a find
   * and replace on the prompt's live text. It waits in the PM agent's "Needs
   * you" list for the clinical advisor or the owner.
   */
  async proposePinnedRule(
    input: { promptCode: string; find: string; replace: string; why: string },
    userId: number,
  ): Promise<{ id: string }> {
    if (!PINNED_RULE_CODES.has(input.promptCode)) {
      throw new BadRequestException(
        `${input.promptCode} is not a pinned rule; pinned: ${[...PINNED_RULE_CODES].join(', ')}`,
      );
    }
    const { bundle } = await this.gaBundle();
    const live = await this.context.promptText(
      input.promptCode,
      bundle.prompts[input.promptCode] ?? null,
    );
    if (!live) {
      throw new NotFoundException(`${input.promptCode} has no live text`);
    }
    const problem = passageProblem(live, input.find);
    if (problem) {
      throw new BadRequestException(PASSAGE_PROBLEM_MESSAGE[problem]);
    }
    if (input.find === input.replace) {
      throw new BadRequestException(
        'The replacement is the same as the passage. Write the new wording.',
      );
    }
    const why = (input.why ?? '').trim();
    if (!why) throw new BadRequestException('Say why the rule should change.');
    const change = {
      ideaKind: 'pinned_rule',
      promptCode: input.promptCode,
      find: input.find,
      replace: input.replace,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(change))
      .digest('hex');
    const rows = await this.dataSource.query(
      `INSERT INTO agent_lessons
         ("agentKey", kind, scope, status, text, change, evidence, "contentHash", "authorKind")
       SELECT $1::varchar, 'prompt', 'platform', 'proposed', $2::varchar, $3::jsonb, $4::jsonb,
              $5::varchar, 'human'
        WHERE NOT EXISTS (SELECT 1 FROM agent_lessons
                           WHERE "agentKey" = $1::varchar AND "contentHash" = $5::varchar)
       RETURNING id`,
      [
        DEBRIEF_AGENT_KEY,
        `${pinnedRuleName(input.promptCode)}: ${why}`.slice(0, 300),
        JSON.stringify(change),
        JSON.stringify({ why, proposedBy: userId }),
        hash,
      ],
    );
    if (!rows?.[0]?.id) {
      throw new ConflictException(
        'This change has already been proposed. Find it in PM agent › Ideas.',
      );
    }
    await this.audit('proposed', rows[0].id, userId, { kind: 'pinned_rule' });
    await this.notifier?.owner({
      title: 'Debriefs: a pinned-rule change needs approval',
      body: `Proposed change to the ${pinnedRuleName(input.promptCode)}: ${why}`,
      data: { ideaId: rows[0].id },
      excludeUserId: userId,
    });
    return { id: rows[0].id };
  }

  /**
   * The clinical advisor or the owner signs a pinned-rule change off: the new
   * text becomes a Skills Store version and a DRAFT release pins it. Nothing
   * reaches learners until a person makes that release live (Releases).
   * The sign-off (who, when) is kept on the idea and read by the pinned-rules
   * list.
   */
  async approvePinnedRule(
    ideaId: string,
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number; promptVersion: number }> {
    const idea = await this.getIdea(ideaId);
    if (idea.change?.ideaKind !== 'pinned_rule') {
      throw new BadRequestException('this idea is not a pinned-rule change');
    }
    if (idea.status !== 'proposed') {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    if (approvalState(idea as any)?.expired) {
      throw new ConflictException(
        'this approval expired after 14 days with no decision',
      );
    }
    const code = idea.change.promptCode as string;
    if (idea.change.firstVersion) {
      return this.approveFirstVersion(idea, userId, note);
    }
    const { bundle } = await this.gaBundle();
    const current = await this.context.promptText(
      code,
      bundle.prompts[code] ?? null,
    );
    if (!current || !current.includes(idea.change.find)) {
      throw new ConflictException(
        'the rule changed since this proposal; its passage is gone',
      );
    }
    const [prompt] = await this.dataSource.query(
      `SELECT id FROM prompts WHERE "promptCode" = $1`,
      [code],
    );
    if (!prompt) {
      throw new NotFoundException(`prompt ${code} is not in the Skills Store`);
    }
    const latest = await this.prompts.latestVersionOf(prompt.id);
    const version = await this.prompts.createVersion(
      prompt.id,
      {
        body: current.replace(idea.change.find, idea.change.replace),
        baseVersion: latest,
        source: PromptVersionSource.EXPERIMENT,
        note: `Pinned-rule change ${ideaId}, approved by user ${userId}: ${idea.text}`.slice(
          0,
          500,
        ),
        evalSummary: null,
        createdBy: userId,
      },
      { translate: 'none' },
    );
    const next: DebriefBundle = JSON.parse(JSON.stringify(bundle));
    let releaseId: string | null = null;
    let releaseVersion: number | null = null;
    if (code in next.prompts) {
      next.prompts[code] = version.version;
      const draft = await this.releases.createDraft(
        DEBRIEF_AGENT_KEY,
        next as unknown as Record<string, unknown>,
        userId,
        `${idea.text} (${pinnedRuleName(code)} v${version.version})`.slice(
          0,
          300,
        ),
      );
      // Plan §8.8: the exact prompt versions it runs, recorded now.
      await this.runner.pinPrompts(draft);
      releaseId = draft.id;
      releaseVersion = draft.version;
    }
    const signedAt = new Date().toISOString();
    await this.writeEvidence(ideaId, 'signoff', {
      by: userId,
      at: signedAt,
      note: note ?? null,
      promptCode: code,
      promptVersion: version.version,
      releaseId,
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'approved', "decidedBy" = $2, "decidedAt" = now(),
              "releaseId" = $3, "updatedAt" = now() WHERE id = $1`,
      [ideaId, userId, releaseId],
    );
    await this.audit('approved', ideaId, userId, {
      kind: 'pinned_rule',
      promptCode: code,
      promptVersion: version.version,
      releaseId,
      note: note ?? null,
    });
    return {
      releaseId: releaseId as string,
      version: releaseVersion as number,
      promptVersion: version.version,
    };
  }

  /**
   * Approving a pinned rule's first version: the text live now, written by
   * engineering and never clinically approved. No new prompt version and no
   * release; only the approval (who, when) is recorded, the same evidence as
   * a change's, so Settings › Pinned rules reads "Approved by …".
   */
  private async approveFirstVersion(
    idea: Record<string, any>,
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number; promptVersion: number }> {
    const code = idea.change.promptCode as string;
    const version = Number(idea.change.version);
    const live = await this.livePinnedRule(code);
    if (!live || live.version !== version) {
      throw new ConflictException(
        `the live ${pinnedRuleName(code)} is no longer v${version}`,
      );
    }
    const at = new Date().toISOString();
    await this.writeEvidence(idea.id, 'signoff', {
      by: userId,
      at,
      note: note ?? null,
      promptCode: code,
      promptVersion: version,
      releaseId: null,
      firstVersion: true,
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'approved', "decidedBy" = $2, "decidedAt" = now(),
              "updatedAt" = now() WHERE id = $1`,
      [idea.id, userId],
    );
    await this.audit('approved', idea.id, userId, {
      kind: 'pinned_rule',
      firstVersion: true,
      promptCode: code,
      promptVersion: version,
      note: note ?? null,
    });
    return {
      releaseId: null as unknown as string,
      version: null as unknown as number,
      promptVersion: version,
    };
  }

  /** A pinned rule's version in force (the live release's pin, else the store's current) and its text. */
  async livePinnedRule(
    code: string,
    bundle?: DebriefBundle,
  ): Promise<{ version: number; text: string } | null> {
    const b = bundle ?? (await this.gaBundle()).bundle;
    const [row] = await this.dataSource.query(
      `SELECT pv.version, pv.prompt FROM prompts p
         JOIN prompts_versions pv ON pv."promptId" = p.id
        WHERE p."promptCode" = $1
          AND pv.version = COALESCE($2::int, p."currentVersion")
        LIMIT 1`,
      [code, (b.prompts as Record<string, number | null>)[code] ?? null],
    );
    return row ? { version: Number(row.version), text: row.prompt } : null;
  }

  private firstVersionsCheckedAt = 0;

  /**
   * Notes "Pinned rules: approval flow": each pinned rule whose version in
   * force has no approval gets one "Needs you" item, "Approve the current
   * Safety rules (v1)". Idempotent: a partial unique index on the item's
   * hash (one per rule and version) makes a second insert a no-op, and none
   * is made once that version is approved. An open item for an older
   * version (the rule moved on) is retired. Runs at boot and from the views,
   * at most once a minute per process unless forced.
   */
  async ensureFirstVersionItems(force = false): Promise<number> {
    const now = Date.now();
    if (!force && now - this.firstVersionsCheckedAt < 60_000) return 0;
    this.firstVersionsCheckedAt = now;
    const { bundle } = await this.gaBundle();
    let created = 0;
    for (const { code } of PINNED_RULE_PROMPTS) {
      const live = await this.livePinnedRule(code, bundle);
      if (!live) continue;
      await this.dataSource.query(
        `UPDATE agent_lessons SET status = 'retired', "updatedAt" = now()
          WHERE "agentKey" = $1 AND status = 'proposed'
            AND change->>'ideaKind' = 'pinned_rule' AND (change->>'firstVersion')::boolean
            AND change->>'promptCode' = $2 AND (change->>'version')::int <> $3`,
        [DEBRIEF_AGENT_KEY, code, live.version],
      );
      const [approved] = await this.dataSource.query(
        `SELECT 1 FROM agent_lessons
          WHERE "agentKey" = $1 AND change->>'ideaKind' = 'pinned_rule'
            AND change->>'promptCode' = $2 AND evidence ? 'signoff'
            AND (evidence->'signoff'->>'promptVersion')::int = $3
          LIMIT 1`,
        [DEBRIEF_AGENT_KEY, code, live.version],
      );
      if (approved) continue;
      const rows = await this.dataSource.query(
        `INSERT INTO agent_lessons
           ("agentKey", kind, scope, status, text, change, evidence, "contentHash", "authorKind")
         VALUES ($1, 'prompt', 'platform', 'proposed', $2, $3::jsonb, '{}'::jsonb, $4, 'system')
         ON CONFLICT ("agentKey", "contentHash")
           WHERE (change->>'firstVersion') = 'true' DO NOTHING
         RETURNING id`,
        [
          DEBRIEF_AGENT_KEY,
          firstVersionTitle(code, live.version),
          JSON.stringify({
            ideaKind: 'pinned_rule',
            promptCode: code,
            firstVersion: true,
            version: live.version,
          }),
          firstVersionHash(code, live.version),
        ],
      );
      if (rows?.[0]?.id) {
        created++;
        await this.audit('proposed', rows[0].id, null, {
          kind: 'pinned_rule',
          firstVersion: true,
          promptCode: code,
          promptVersion: live.version,
        });
      }
    }
    return created;
  }

  /** Withdraw one's own pinned-rule proposal: closed as withdrawn, audited. */
  async withdrawPinnedRule(ideaId: string, userId: number): Promise<void> {
    const idea = await this.getIdea(ideaId);
    if (idea.change?.ideaKind !== 'pinned_rule') {
      throw new BadRequestException('this idea is not a pinned-rule change');
    }
    if (idea.change.firstVersion) {
      throw new BadRequestException(
        'a first version cannot be withdrawn; ask for a change instead',
      );
    }
    if (idea.status !== 'proposed') {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    if (Number(idea.evidence?.proposedBy) !== userId) {
      throw new ForbiddenException(
        'only the person who proposed it may withdraw it',
      );
    }
    await this.writeEvidence(ideaId, 'withdrawn', {
      by: userId,
      at: new Date().toISOString(),
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'retired', "decidedBy" = $2, "decidedAt" = now(),
              "updatedAt" = now() WHERE id = $1`,
      [ideaId, userId],
    );
    await this.audit('retired', ideaId, userId, {
      kind: 'pinned_rule',
      withdrawn: true,
    });
  }

  /**
   * Reject a pinned-rule change (clinical advisor or owner), with a reason
   * the PM agent reads in `idea_outcomes`. Never a first version (a base
   * must exist), never one's own proposal (withdraw it).
   */
  async rejectPinnedRule(
    ideaId: string,
    userId: number,
    reason: string,
  ): Promise<void> {
    const idea = await this.getIdea(ideaId);
    if (idea.change?.ideaKind !== 'pinned_rule') {
      throw new BadRequestException('this idea is not a pinned-rule change');
    }
    if (idea.change.firstVersion) {
      throw new BadRequestException(
        'a first version cannot be rejected; ask for a change instead',
      );
    }
    if (Number(idea.evidence?.proposedBy) === userId) {
      throw new BadRequestException('withdraw your own proposal instead');
    }
    const why = (reason ?? '').trim();
    if (!why) throw new BadRequestException('Say why you are rejecting it.');
    await this.rejectIdea(idea, userId, why);
  }

  /**
   * What a pinned-rule item carries on the PM agent page: the whole rule with
   * the changed passage highlighted (advisors cannot open the Skills Store),
   * the live text a further change is written against, whether another
   * proposal on the rule is open, and the viewer's buttons.
   */
  async pinnedRuleDetails(
    ideas: Array<Record<string, any>>,
    viewer: { userId: number; can: { approvePinnedRule: boolean } },
  ): Promise<void> {
    const pinned = ideas.filter((i) => i.change?.ideaKind === 'pinned_rule');
    if (!pinned.length) return;
    const { bundle } = await this.gaBundle();
    const live = new Map<string, { version: number; text: string } | null>();
    for (const i of pinned) {
      const code = i.change.promptCode as string;
      if (!live.has(code))
        live.set(code, await this.livePinnedRule(code, bundle));
    }
    const openProposals = (code: string, except: string) =>
      pinned.filter(
        (o) =>
          o.id !== except &&
          o.status === 'proposed' &&
          !o.change.firstVersion &&
          o.change.promptCode === code,
      ).length;
    for (const i of pinned) {
      const code = i.change.promptCode as string;
      const rule = live.get(code) ?? null;
      const firstVersion = !!i.change.firstVersion;
      const mine =
        !firstVersion && Number(i.evidence?.proposedBy) === viewer.userId;
      const open = i.status === 'proposed' && !i.approval?.expired;
      const actions = pinnedRuleActions({
        open,
        firstVersion,
        mine,
        mayDecide: viewer.can.approvePinnedRule,
      });
      const after =
        open && rule
          ? textAfterChange(
              rule.text,
              firstVersion ? null : i.change.find,
              i.change.replace,
            )
          : null;
      i.pinnedRule = {
        name: pinnedRuleName(code),
        firstVersion,
        mine,
        proposedBy: i.evidence?.proposedBy ?? null,
        liveVersion: rule?.version ?? null,
        liveText: open ? (rule?.text ?? null) : null,
        segments: after?.segments ?? null,
        stale: after?.stale ?? false,
        otherOpen: open ? openProposals(code, i.id) : 0,
        approvedNote:
          i.status === 'approved'
            ? 'Approved. The Ally team will put it live.'
            : null,
      };
      i.can = {
        ...(i.can ?? {}),
        approve: actions.approve,
        reject: actions.reject,
        withdraw: actions.withdraw,
        askForChange: actions.askForChange,
      };
    }
  }

  // --- Closing the loop (spec C5, FR-64) ------------------------------------------

  /**
   * For every idea that went live and has stood PM_HOLD_DAYS, read the metric
   * it named now, against the baseline idea_propose recorded, and record
   * whether it moved the way the idea said. Once per idea.
   */
  async checkForecasts(now = new Date()): Promise<number> {
    const due: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT l.id, l.evidence, rel."promotedAt" AS promoted_at
         FROM agent_lessons l
         JOIN agent_releases rel ON rel.id = l."releaseId"
        WHERE l."agentKey" = $1 AND l.status = 'active'
          AND l.evidence ? 'forecast' AND NOT (l.evidence->'forecast' ? 'checkedAt')
          AND rel."promotedAt" IS NOT NULL
          AND rel."promotedAt" <= $2::timestamp - make_interval(days => $3)`,
      [DEBRIEF_AGENT_KEY, now.toISOString(), PM_HOLD_DAYS],
    );
    if (!due.length) return 0;
    const values = metricValues(
      (await this.metrics.view(4)) as unknown as MetricsViewLike,
    );
    for (const idea of due) {
      const f = idea.evidence.forecast;
      const after = values[f.metric] ?? null;
      await this.writeEvidence(idea.id, 'forecast', {
        ...f,
        ...forecastOutcome(f, after),
        checkedAt: now.toISOString(),
      });
      await this.audit('pipeline_step', idea.id, null, {
        step: 'forecast_checked',
        metric: f.metric,
        baseline: f.baseline,
        after,
      });
    }
    return due.length;
  }

  async reject(ideaId: string, userId: number, reason?: string): Promise<void> {
    const idea = await this.getIdea(ideaId);
    // Pinned rules are the clinical advisor's or the owner's to reject, with
    // a reason (rejectPinnedRule); this route is the Ally team's.
    if (idea.change?.ideaKind === 'pinned_rule') {
      throw new ForbiddenException(
        'a pinned-rule change is rejected by the clinical advisor or the owner (reject-pinned-rule)',
      );
    }
    await this.rejectIdea(idea, userId, reason?.trim() || null);
  }

  /**
   * Set an idea aside as rejected. The reason is kept on the idea
   * (`evidence.rejection`) as well as in the audit, so the PM agent reads it
   * with the outcome of its ideas.
   */
  private async rejectIdea(
    idea: Record<string, any>,
    userId: number,
    reason: string | null,
  ): Promise<void> {
    if (['active', 'rejected', 'retired'].includes(idea.status)) {
      throw new ConflictException(`this idea is already ${idea.status}`);
    }
    await this.writeEvidence(idea.id, 'rejection', {
      by: userId,
      at: new Date().toISOString(),
      reason,
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'rejected', "decidedBy" = $2, "decidedAt" = now(),
              "updatedAt" = now() WHERE id = $1`,
      [idea.id, userId],
    );
    await this.audit('rejected', idea.id, userId, {
      reason,
      ...(idea.change?.ideaKind === 'pinned_rule'
        ? { kind: 'pinned_rule' }
        : {}),
    });
  }

  /** The latest run's report, when it ran, and its step records. */
  async latestReport(): Promise<{
    report: string | null;
    at: string | null;
    status: string | null;
    steps: unknown[];
    costUsd: number | null;
    refusals: unknown[];
    learningSpentUsd: number | null;
  }> {
    const rows = await this.dataSource.query(
      `SELECT detail, "createdAt" FROM agent_lesson_audit
        WHERE "agentKey" = $1 AND action = 'curator_run' AND detail ? 'report'
          AND detail->>'review' IS DISTINCT FROM 'questions'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    const r = rows?.[0];
    return {
      report: r?.detail?.report ?? null,
      at: r ? new Date(r.createdAt).toISOString() : null,
      status: r?.detail?.status ?? null,
      steps: r?.detail?.steps ?? [],
      costUsd: r?.detail?.costUsd ?? null,
      refusals: r?.detail?.refusals ?? [],
      learningSpentUsd: r?.detail?.learningSpentUsd ?? null,
    };
  }

  /** A ladder event with no single idea (the monthly sealed run), for the Console's series. */
  async recordLadderEvent(detail: Record<string, unknown>): Promise<void> {
    await this.audit('pipeline_step', null, null, detail);
  }

  async audit(
    action: string,
    lessonId: string | null,
    userId: number | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO agent_lesson_audit ("agentKey", "lessonId", action, "actorKind", "actorUserId", detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        DEBRIEF_AGENT_KEY,
        lessonId,
        action,
        userId ? 'human' : 'curator',
        userId,
        JSON.stringify(detail),
      ],
    );
  }
}

/** A metric moved "the way it said" when it changed in the named direction by more than noise. */
const MOVE_EPSILON = 0.01;

export function forecastOutcome(
  f: {
    metric: string;
    direction: 'up' | 'down';
    baseline: number | null;
    by?: number | null;
  },
  after: number | null,
): {
  after: number | null;
  moved: boolean | null;
  delta: number | null;
  hitBy: boolean | null;
} {
  if (f.baseline == null || after == null) {
    return { after, moved: null, delta: null, hitBy: null };
  }
  const delta = Math.round((after - f.baseline) * 1000) / 1000;
  const sign = f.direction === 'up' ? 1 : -1;
  const moved = delta * sign > MOVE_EPSILON * Math.max(1, Math.abs(f.baseline));
  return {
    after,
    moved,
    delta,
    hitBy: f.by == null ? null : moved && Math.abs(delta) >= Math.abs(f.by),
  };
}

/** Builder's hand-off context: the agent's brief (quotes already stripped by the gateway). */
export function builderHandoffText(idea: Record<string, any>): string {
  const h = idea.evidence?.handoff ?? {};
  return [
    `Debrief PM agent idea ${idea.id}: ${idea.text}`,
    `Problem: ${h.problem ?? ''}`,
    `Evidence (no learner quotes): ${h.evidenceSummary ?? ''}`,
    `Expected effect: ${h.expectedEffect ?? ''}`,
    'Acceptance checks:',
    ...((h.acceptanceChecks ?? []) as string[]).map((c) => `- ${c}`),
  ].join('\n');
}

/** Bug Hunter's report: the summary and the debrief run ids. */
export function bugReportText(idea: Record<string, any>): string {
  const h = idea.evidence?.handoff ?? {};
  const runs = ((h.runIds ?? []) as string[]).join(', ');
  return `[Debrief PM agent] ${h.summary ?? idea.text}${runs ? `\nDebrief runs: ${runs}` : ''}`;
}

/**
 * Why a PM agent prompt edit may not go on to learners (R2-18), or null: the
 * draft's evidence record (learners and organisations counted by
 * release_draft) falls short, or the edit adds instructions to a model.
 */
export function selfMadeEditProblem(idea: Record<string, any>): string | null {
  const draft = idea.evidence?.draft ?? {};
  const short = changeEvidenceRefusal(
    'a prompt edit',
    Number(draft.learners) || 0,
    Number(draft.tenants) || 0,
  );
  if (short) return `${short.reason}; draft it again with release_draft`;
  const pattern = introducedInstructionPattern(
    String(idea.change?.find ?? ''),
    String(idea.change?.replace ?? ''),
  );
  return pattern
    ? `a prompt edit must not add instructions that steer or override a model ("${pattern}")`
    : null;
}
