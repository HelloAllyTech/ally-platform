import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { runWithConcurrency } from '../../analytics/util/judge-concurrency.util';
import { debriefOverallSql } from '../../analytics/constants/debrief-quality.constants';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { PromptVersioningService } from '../../prompt/service/prompt-versioning.service';
import { PromptVersionSource } from '../../prompt/entity/prompt-version.entity';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_PROMPT_CODES,
  DebriefBundle,
  DebriefRecipeKey,
  IMPROVER_EDITABLE_PROMPTS,
  IMPROVER_SETTINGS,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefRunArm, DebriefRunMode } from '../enum/debrief-run.enum';
import { DebriefAiClient } from './debrief-ai.client';
import { DebriefContextRepository } from './debrief-context.repository';
import {
  DebriefRunJudgeService,
  RunJudgment,
} from './debrief-run-judge.service';
import { DebriefRunnerService, RunOptions } from './debrief-runner.service';
import {
  DebriefTestSet,
  DebriefTestSetsService,
} from './debrief-test-sets.service';

/** The Improver's monthly learning budget (plan §10.2), separate from production. */
export const LEARNING_BUDGET_USD = 150;
/** A screen: this many open-set sessions, each run as baseline and challenger. */
export const SCREEN_CASES = 6;
/** A screen passes when the challenger's mean judge score is at least this much higher, with no new hard fail. */
export const SCREEN_MIN_LIFT = 0.2;
/** Sessions screened at once; each runs both arms side by side. */
const SCREEN_CONCURRENCY = 3;

export type ImproverIdeaKind =
  | 'prompt_edit'
  | 'setting'
  | 'needs_code'
  | 'defect'
  | 'needs_person';

export interface ImproverIdea {
  kind: ImproverIdeaKind;
  title: string;
  hypothesis: string;
  evidence: string;
  prompt_code?: string | null;
  find?: string | null;
  replace?: string | null;
  setting_key?: string | null;
  setting_value?: string | null;
  expected_effect: string;
}

export interface ScreenResult {
  status: 'done';
  cases: number;
  /** Sessions where both arms produced a judged debrief; the means are over these. */
  pairs: number;
  baselineMean: number | null;
  challengerMean: number | null;
  lift: number | null;
  baselineHardFails: number;
  challengerHardFails: number;
  /** Runs with nothing to judge: needs a person, failed, or the judge gave no answer. */
  baselineFailures: number;
  challengerFailures: number;
  challengerCheckFailures: number;
  costUsd: number;
  passed: boolean;
  ranAt: string;
}

const mean = (xs: number[]) =>
  xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100
    : null;

/** What the Improver reads each run: aggregates only, never a transcript. */
export interface ImproverSignals {
  windowDays: number;
  runs: number;
  byStatus: Record<string, number>;
  byRecipe: Record<string, number>;
  fallbackRungs: Record<string, number>;
  costUsd: { p50: number | null; p90: number | null };
  durationS: { p50: number | null; p90: number | null };
  revisionRounds: { mean: number | null };
  evaluator: { mean: number | null };
  judge: {
    scored: number;
    mean: number | null;
    passRate: number | null;
    hardFailRate: number | null;
    dimensions: Record<string, number | null>;
  };
  todayDebriefJudgeMean: number | null;
  checkFailures: Record<string, number>;
  hardFails: Record<string, number>;
  byLanguage: Record<string, { runs: number; judgeMean: number | null }>;
}

/**
 * The Improver (plan §11), v0: once a day it reads aggregate signals from
 * the Debrief agent's runs, writes a short report for people and proposes
 * ideas; ideas it can try itself (a prompt edit or a setting) are screened on
 * the open test set straight away, paired against the current release. A
 * person approves anything that would reach learners: approval writes the
 * prompt version to the Skills Store, builds a new release from GA and makes
 * it GA, all of which a one-click rollback undoes.
 *
 * Built on the agent harness's learning tables: an idea is an
 * `agent_lessons` row (agentKey `debrief`, authorKind `curator`), each
 * analysis is a `curator_run` row in `agent_lesson_audit` carrying the
 * report, and spend is read from `llm_usage` and the replay runs.
 */
@Injectable()
export class DebriefImproverService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefImproverService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: DebriefAiClient,
    private readonly context: DebriefContextRepository,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly testSets: DebriefTestSetsService,
    private readonly releases: AgentReleaseService,
    private readonly prompts: PromptVersioningService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', 'debrief-improver', async () => {
      await this.testSets.build();
      await this.analyse();
    });
  }

  // --- Learning budget ----------------------------------------------------------

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
    const improver = usage.reduce(
      (n, u) => n + computeCostUsd(u.model, Number(u.p), Number(u.c)).costUsd,
      0,
    );
    // Judging a replay costs about what judging today's debrief does.
    const judged = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM debrief_runs
        WHERE mode = 'replay' AND workspace ? 'judge'
          AND "createdAt" >= date_trunc('month', now())`,
    );
    return Number(replay[0].usd) + improver + Number(judged[0].n) * 0.04;
  }

  // --- Signals -------------------------------------------------------------------

  async signals(windowDays = 7): Promise<ImproverSignals> {
    const q = (sql: string) =>
      this.dataSource.query(sql, [windowDays]) as Promise<
        Array<Record<string, any>>
      >;
    const base = `FROM debrief_runs r WHERE r.mode IN ('shadow','live')
                    AND r."createdAt" >= now() - make_interval(days => $1)`;
    const counts = (rows: Array<Record<string, any>>) =>
      Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]));
    const [summary] = await q(
      `SELECT count(*)::int AS runs,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(r."actualCostUsd", r."estimatedCostUsd")) AS c50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY COALESCE(r."actualCostUsd", r."estimatedCostUsd")) AS c90,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r."finishedAt" - r."startedAt")) AS d50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM r."finishedAt" - r."startedAt")) AS d90,
              avg(r."revisionRounds")::float AS rounds,
              avg(r."evaluatorOverall")::float AS evaluator,
              count(*) FILTER (WHERE r.workspace ? 'judge')::int AS scored,
              avg((r.workspace->'judge'->>'overall')::float) AS judge_mean,
              avg(CASE WHEN (r.workspace->'judge'->>'overall')::float >= 8
                        AND jsonb_array_length(r.workspace->'judge'->'hardFails') = 0 THEN 1 ELSE 0 END)
                FILTER (WHERE r.workspace ? 'judge')::float AS pass_rate,
              avg(CASE WHEN jsonb_array_length(r.workspace->'judge'->'hardFails') > 0 THEN 1 ELSE 0 END)
                FILTER (WHERE r.workspace ? 'judge')::float AS hard_fail_rate
         ${base} AND r.status <> 'skipped'`,
    );
    const round = (v: unknown, d = 2) =>
      v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;
    const dims = await q(
      `SELECT d->>'dimension' AS k, avg((d->>'score')::float) AS n
         FROM debrief_runs r, jsonb_array_elements(r.workspace->'judge'->'dimensions') d
        WHERE r.mode IN ('shadow','live') AND r.workspace ? 'judge'
          AND r."createdAt" >= now() - make_interval(days => $1)
        GROUP BY 1`,
    );
    const byLanguage = await q(
      `SELECT COALESCE(r.language,'unknown') AS k, count(*)::int AS n,
              avg((r.workspace->'judge'->>'overall')::float) AS j
         ${base} AND r.status <> 'skipped' GROUP BY 1`,
    );
    // Today's debriefs over the same window, by the same judge: the bar to beat.
    const [today] = await q(
      `SELECT avg(${debriefOverallSql('j')}) AS m
         FROM debrief_quality_judgment j
        WHERE j."occurredAt" >= now() - make_interval(days => $1)`,
    );
    return {
      windowDays,
      runs: Number(summary?.runs ?? 0),
      byStatus: counts(
        await q(`SELECT r.status AS k, count(*)::int AS n ${base} GROUP BY 1`),
      ),
      byRecipe: counts(
        await q(
          `SELECT COALESCE(r."recipeKey",'none') AS k, count(*)::int AS n ${base} GROUP BY 1`,
        ),
      ),
      fallbackRungs: counts(
        await q(
          `SELECT r."fallbackRung" AS k, count(*)::int AS n ${base} GROUP BY 1`,
        ),
      ),
      costUsd: { p50: round(summary?.c50, 4), p90: round(summary?.c90, 4) },
      durationS: { p50: round(summary?.d50, 0), p90: round(summary?.d90, 0) },
      revisionRounds: { mean: round(summary?.rounds) },
      evaluator: { mean: round(summary?.evaluator) },
      judge: {
        scored: Number(summary?.scored ?? 0),
        mean: round(summary?.judge_mean),
        passRate: round(summary?.pass_rate),
        hardFailRate: round(summary?.hard_fail_rate),
        dimensions: Object.fromEntries(dims.map((d) => [d.k, round(d.n)])),
      },
      todayDebriefJudgeMean: round(today?.m),
      checkFailures: counts(
        await q(`SELECT f->>'code' AS k, count(*)::int AS n
                   FROM debrief_runs r, jsonb_array_elements(r."checkFailures") f
                  WHERE r.mode IN ('shadow','live')
                    AND r."createdAt" >= now() - make_interval(days => $1)
                  GROUP BY 1`),
      ),
      hardFails: counts(
        await q(`SELECT f->>'code' AS k, count(*)::int AS n
                   FROM debrief_runs r, jsonb_array_elements(r.workspace->'judge'->'hardFails') f
                  WHERE r.mode IN ('shadow','live') AND r.workspace ? 'judge'
                    AND r."createdAt" >= now() - make_interval(days => $1)
                  GROUP BY 1`),
      ),
      byLanguage: Object.fromEntries(
        byLanguage.map((r) => [
          r.k,
          { runs: Number(r.n), judgeMean: round(r.j) },
        ]),
      ),
    };
  }

  // --- Analysis -------------------------------------------------------------------

  private async gaBundle(): Promise<{
    id: string | null;
    bundle: DebriefBundle;
  }> {
    const { release, bundle } = await this.runner.resolveRelease();
    return { id: release?.id ?? null, bundle };
  }

  /** Ideas the Improver has had, newest first, with what happened to each. */
  async history(limit = 30): Promise<Array<Record<string, any>>> {
    return this.dataSource.query(
      `SELECT l.id, l.status, l.text AS title, l.change, l.evidence, l."createdAt",
              r.version AS "releaseVersion", r.status AS "releaseStatus"
         FROM agent_lessons l
         LEFT JOIN agent_releases r ON r.id = l."releaseId"
        WHERE l."agentKey" = $1
        ORDER BY l."createdAt" DESC
        LIMIT $2`,
      [DEBRIEF_AGENT_KEY, limit],
    );
  }

  /**
   * One analysis: signals → report + ideas → screens. Skips (and says why)
   * when the learning budget is spent or there is nothing to read yet.
   */
  async analyse(opts: { actorUserId?: number | null } = {}): Promise<{
    report: string | null;
    ideas: string[];
    skipped?: string;
  }> {
    const spent = await this.learningSpentThisMonth();
    if (spent >= LEARNING_BUDGET_USD) {
      await this.audit('curator_run', null, opts.actorUserId ?? null, {
        skipped: 'learning budget spent',
        spentUsd: spent,
      });
      return { report: null, ideas: [], skipped: 'learning budget spent' };
    }
    const signals = await this.signals();
    if (signals.runs === 0) {
      return { report: null, ideas: [], skipped: 'no runs to read yet' };
    }
    const { id: gaId, bundle } = await this.gaBundle();
    const promptTexts: Record<string, string> = {};
    for (const code of IMPROVER_EDITABLE_PROMPTS) {
      const text = await this.context.promptText(
        code,
        bundle.prompts[code] ?? null,
      );
      if (text) promptTexts[code] = text;
    }
    const settings: Record<string, unknown> = {
      maxRevisionRounds:
        bundle.recipes[DebriefRecipeKey.STANDARD].maxRevisionRounds,
      ...Object.fromEntries(
        Object.keys(IMPROVER_SETTINGS)
          .filter((k) => k !== 'maxRevisionRounds')
          .map((k) => [
            k,
            (bundle.settings as unknown as Record<string, unknown>)[k],
          ]),
      ),
      allowedRanges: IMPROVER_SETTINGS,
    };
    const history = (await this.history()).map((h) => ({
      title: h.title,
      status: h.status,
      kind: h.change?.ideaKind,
      screen: h.evidence?.screen
        ? { lift: h.evidence.screen.lift, passed: h.evidence.screen.passed }
        : null,
    }));
    const system = await this.context.promptText(
      DEBRIEF_PROMPT_CODES.improver,
      null,
    );
    const res = await this.ai.step<{
      model: string;
      analysis: { report: string; ideas: ImproverIdea[] };
    }>('improver/analyse', {
      signals,
      prompts: promptTexts,
      settings,
      history,
      system_prompt: system,
    });

    const ideaIds: string[] = [];
    for (const idea of res.analysis.ideas) {
      const id = await this.saveIdea(idea, signals, gaId);
      if (id) ideaIds.push(id);
    }
    await this.audit('curator_run', null, opts.actorUserId ?? null, {
      report: res.analysis.report,
      model: res.model,
      signals,
      ideaIds,
      learningSpentUsd: Math.round(spent * 100) / 100,
    });

    for (const id of ideaIds) {
      if ((await this.learningSpentThisMonth()) >= LEARNING_BUDGET_USD) break;
      const idea = await this.getIdea(id);
      if (['prompt_edit', 'setting'].includes(idea.change?.ideaKind)) {
        await this.screen(id).catch((e: Error) =>
          this.logger.warn(
            `[improver] screen ${id} failed: ${(e as Error).message}`,
          ),
        );
      }
    }
    return { report: res.analysis.report, ideas: ideaIds };
  }

  /** Refuses (blocks) anything the Improver may not change, before it costs anything. */
  blockReason(idea: ImproverIdea): string | null {
    if (idea.kind === 'prompt_edit') {
      if (
        !idea.prompt_code ||
        !IMPROVER_EDITABLE_PROMPTS.has(idea.prompt_code)
      ) {
        return 'that prompt is pinned or not the Improver’s to edit';
      }
      if (!idea.find || idea.replace == null) return 'the edit is incomplete';
    }
    if (idea.kind === 'setting') {
      const range = idea.setting_key
        ? IMPROVER_SETTINGS[idea.setting_key]
        : null;
      const v = Number(idea.setting_value);
      if (!range) return 'that setting is not the Improver’s to change';
      if (!Number.isFinite(v) || v < range.min || v > range.max) {
        return `the value is outside ${range.min}–${range.max}`;
      }
    }
    return null;
  }

  private async saveIdea(
    idea: ImproverIdea,
    signals: ImproverSignals,
    gaId: string | null,
  ): Promise<string | null> {
    const lessonKind =
      idea.kind === 'prompt_edit'
        ? 'prompt'
        : idea.kind === 'setting'
          ? 'policy'
          : 'lesson';
    const block = this.blockReason(idea);
    const change = {
      ideaKind: idea.kind,
      promptCode: idea.prompt_code ?? null,
      find: idea.find ?? null,
      replace: idea.replace ?? null,
      settingKey: idea.setting_key ?? null,
      settingValue: idea.setting_value ?? null,
      baseReleaseId: gaId,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify({ t: idea.title, change }))
      .digest('hex');
    const rows = await this.dataSource.query(
      `INSERT INTO agent_lessons
         ("agentKey", kind, scope, status, text, change, evidence, "blockReason",
          "contentHash", "authorKind")
       SELECT $1::varchar, $2::varchar, 'platform', $3::varchar, $4::varchar, $5::jsonb,
              $6::jsonb, $7::varchar, $8::varchar, 'curator'
        WHERE NOT EXISTS (SELECT 1 FROM agent_lessons
                           WHERE "agentKey" = $1::varchar AND "contentHash" = $8::varchar)
       RETURNING id`,
      [
        DEBRIEF_AGENT_KEY,
        lessonKind,
        block ? 'blocked' : 'proposed',
        idea.title.slice(0, 400),
        JSON.stringify(change),
        JSON.stringify({
          hypothesis: idea.hypothesis,
          evidence: idea.evidence,
          expectedEffect: idea.expected_effect,
          signalsAt: { runs: signals.runs, judgeMean: signals.judge.mean },
        }),
        block ? block.slice(0, 40) : null,
        hash,
      ],
    );
    const id = rows?.[0]?.id ?? null;
    if (id)
      await this.audit(block ? 'blocked' : 'proposed', id, null, {
        kind: idea.kind,
      });
    return id;
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
   * The screen (rung one of the experiment ladder): run the current release
   * and the challenger on the same open-set sessions, judge both blind with
   * the independent judge, and compare. Paid from the learning budget.
   *
   * Checks everything that can be checked up front, marks the idea's screen
   * as running and returns; the runs take minutes, so they finish in the
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
    if ((await this.learningSpentThisMonth()) >= LEARNING_BUDGET_USD) {
      throw new ConflictException(
        'the learning budget for this month is spent',
      );
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
    if (challengerBundle && validateDebriefBundle(challengerBundle).length) {
      throw new BadRequestException(
        validateDebriefBundle(challengerBundle).join('; '),
      );
    }
    const sessions = await this.testSets.sessions(
      DebriefTestSet.OPEN,
      SCREEN_CASES,
    );
    if (sessions.length === 0) {
      throw new ConflictException(
        'the open test set is empty; build the test sets first',
      );
    }
    const startedAt = new Date().toISOString();
    await this.writeScreen(ideaId, { status: 'running', startedAt });
    void this.runScreen(ideaId, sessions, {
      promptOverrides: challenger.promptOverrides,
      settingOverrides: challenger.settingOverrides,
      release: challengerBundle
        ? ({ id: null, version: null, bundle: challengerBundle } as any)
        : undefined,
    }).catch(async (e) => {
      this.logger.error(
        `[improver] screen ${ideaId} failed: ${(e as Error).message}`,
      );
      await this.writeScreen(ideaId, {
        status: 'failed',
        startedAt,
        error: (e as Error).message.slice(0, 300),
      }).catch(() => undefined);
    });
    return { status: 'running', startedAt };
  }

  private async runScreen(
    ideaId: string,
    sessions: string[],
    challengerOpts: Partial<RunOptions>,
  ): Promise<ScreenResult> {
    const pairs: Array<{
      base: RunJudgment | null;
      chal: RunJudgment | null;
      chalChecks: number;
      cost: number;
    }> = [];
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
      // A run with nothing publishable, or a judge that gave no answer, is
      // recorded as "no score" — never as a zero, which would hand the other
      // arm a lift it did not earn.
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
          chalChecks: c.run.checkFailures.length,
          cost: Number(b.run.estimatedCostUsd) + Number(c.run.estimatedCostUsd),
        });
      },
    );

    const scored = pairs.filter(
      (p) => p.base?.overall != null && p.chal?.overall != null,
    );
    const bm = mean(scored.map((p) => p.base!.overall as number));
    const cm = mean(scored.map((p) => p.chal!.overall as number));
    const lift =
      bm != null && cm != null ? Math.round((cm - bm) * 100) / 100 : null;
    const baselineFailures = pairs.filter((p) => !p.base).length;
    const challengerFailures = pairs.filter((p) => !p.chal).length;
    const baselineHardFails = pairs.filter(
      (p) => p.base?.hardFails.length,
    ).length;
    const challengerHardFails = pairs.filter(
      (p) => p.chal?.hardFails.length,
    ).length;
    const result: ScreenResult = {
      status: 'done',
      cases: sessions.length,
      pairs: scored.length,
      baselineMean: bm,
      challengerMean: cm,
      lift,
      baselineHardFails,
      challengerHardFails,
      baselineFailures,
      challengerFailures,
      challengerCheckFailures: pairs.reduce((n, p) => n + p.chalChecks, 0),
      costUsd: Math.round(pairs.reduce((n, p) => n + p.cost, 0) * 100) / 100,
      passed:
        lift != null &&
        scored.length >= Math.ceil(sessions.length / 2) &&
        lift >= SCREEN_MIN_LIFT &&
        challengerHardFails <= baselineHardFails &&
        challengerFailures <= baselineFailures,
      ranAt: new Date().toISOString(),
    };
    await this.writeScreen(
      ideaId,
      result as unknown as Record<string, unknown>,
    );
    await this.audit('pipeline_step', ideaId, null, {
      step: 'screen',
      ...result,
    });
    return result;
  }

  private async writeScreen(
    ideaId: string,
    screen: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE agent_lessons SET evidence = evidence || jsonb_build_object('screen', $2::jsonb),
              "updatedAt" = now()
        WHERE id = $1::uuid`,
      [ideaId, JSON.stringify(screen)],
    );
  }

  /**
   * A person approves: the change becomes a new release and goes GA. A prompt
   * edit is written to the Skills Store as a new version (never made the
   * store's current version — the release pins it), so rollback restores the
   * previous release and every version it named.
   */
  async approve(
    ideaId: string,
    userId: number,
    note?: string,
  ): Promise<{ releaseId: string; version: number }> {
    const idea = await this.getIdea(ideaId);
    if (!['proposed', 'approved'].includes(idea.status)) {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    const kind = idea.change?.ideaKind;
    if (kind !== 'prompt_edit' && kind !== 'setting') {
      throw new BadRequestException(
        'only prompt edits and settings become releases; this one needs a person to act on it',
      );
    }
    // The ladder holds: only a change that did better on the open set, with
    // no new hard fails, may be put live.
    const screen = idea.evidence?.screen;
    if (screen?.status !== 'done' || !screen.passed) {
      throw new ConflictException(
        'only a change that did better when tried can go live; try it first',
      );
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
          note: `Debrief Improver idea ${ideaId}: ${idea.text}`.slice(0, 500),
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
    const problems = validateDebriefBundle(next);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const draft = await this.releases.createDraft(
      DEBRIEF_AGENT_KEY,
      next as unknown as Record<string, unknown>,
      userId,
      `Improver idea: ${idea.text}`,
    );
    await this.releases.makeGa(
      draft.id,
      userId,
      AgentReleaseAuditAction.PROMOTED,
      note,
    );
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'active', "releaseId" = $2, "updatedAt" = now() WHERE id = $1`,
      [ideaId, draft.id],
    );
    await this.audit('activated', ideaId, userId, {
      releaseId: draft.id,
      version: draft.version,
      note: note ?? null,
    });
    return { releaseId: draft.id, version: draft.version };
  }

  async reject(ideaId: string, userId: number, reason?: string): Promise<void> {
    const idea = await this.getIdea(ideaId);
    if (['active', 'rejected'].includes(idea.status)) {
      throw new ConflictException(`this idea is already ${idea.status}`);
    }
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'rejected', "updatedAt" = now() WHERE id = $1`,
      [ideaId],
    );
    await this.audit('rejected', ideaId, userId, { reason: reason ?? null });
  }

  /** The latest analysis's report and when it ran. */
  async latestReport(): Promise<{
    report: string | null;
    at: string | null;
    signals: unknown;
    learningSpentUsd: number | null;
  }> {
    const rows = await this.dataSource.query(
      `SELECT detail, "createdAt" FROM agent_lesson_audit
        WHERE "agentKey" = $1 AND action = 'curator_run' AND detail ? 'report'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    const r = rows?.[0];
    return {
      report: r?.detail?.report ?? null,
      at: r ? new Date(r.createdAt).toISOString() : null,
      signals: r?.detail?.signals ?? null,
      learningSpentUsd: r?.detail?.learningSpentUsd ?? null,
    };
  }

  private async audit(
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
