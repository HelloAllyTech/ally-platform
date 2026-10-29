import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import {
  computeDebriefOverall,
  DebriefQualityDimension,
} from '../../analytics/constants/debrief-quality.constants';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  DebriefRecipe,
  DebriefRecipeKey,
  DebriefStep,
  RecipeStep,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefRun, DebriefRunStepRecord } from '../entity/debrief-run.entity';
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import {
  checkWeight,
  DebriefCards,
  DebriefCheckFailure,
  renderCards,
  runDebriefChecks,
  SafetyReading,
  TranscriptTurn,
} from '../util/debrief-cards.util';
import {
  effectiveRunCeiling,
  estimateStepCostUsd,
  FallbackRung,
} from '../util/debrief-budget.util';
import { DebriefAiClient, DebriefStepError } from './debrief-ai.client';
import {
  DebriefContextRepository,
  DebriefSessionContext,
} from './debrief-context.repository';

export interface RunOptions {
  mode: DebriefRunMode;
  /** Run this release instead of GA (replays of a candidate). */
  release?: AgentRelease | null;
  /** Replace a prompt's text for this run only (a challenger in a screen). */
  promptOverrides?: Record<string, string>;
  /** Replace bundle settings for this run only. */
  settingOverrides?: Partial<DebriefBundle['settings']>;
  experimentId?: string | null;
  arm?: DebriefRunArm | null;
  /** For tests: the clock. */
  now?: () => number;
}

interface Evaluation {
  overall: number | null;
  hardFails: Array<{ code: string; evidence: string }>;
  fixes: Array<{ section: string; note: string }>;
  dimensions: Array<{ dimension: string; score: number }>;
}

interface Draft {
  cards: DebriefCards;
  checks: DebriefCheckFailure[];
  evaluation: Evaluation | null;
  round: number;
}

/** A draft is publishable when it passes every check. */
const passesChecks = (d: Draft) => d.checks.length === 0;

/** Better = passes the checks, then fewer weighted failures, then higher overall, then no hard fail. */
export function betterDraft(a: Draft | null, b: Draft): Draft {
  if (!a) return b;
  const key = (d: Draft) => [
    passesChecks(d) ? 1 : 0,
    -checkWeight(d.checks),
    d.evaluation?.hardFails.length ? 0 : 1,
    d.evaluation?.overall ?? -1,
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    if (kb[i] !== ka[i]) return kb[i] > ka[i] ? b : a;
  }
  return a;
}

/**
 * Runs one session's debrief by its recipe (plan §8): the fixed pre-run
 * checks, then the recipe's steps in order, the check → evaluate ⇄ revise
 * loop, the budget and the deadline, and the fallback ladder when either runs
 * out. Every step is recorded on the run as it happens, so the Console can
 * draw the timeline and the Improver can read what went wrong.
 *
 * The guarantees hold whatever the recipe says: the safety reader always runs
 * and its failure stops the run; nothing is published without passing the
 * checks and the evaluation; budget and deadline are hard limits.
 */
@Injectable()
export class DebriefRunnerService {
  private readonly logger = LoggerService.getInstance(
    DebriefRunnerService.name,
  );

  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly context: DebriefContextRepository,
    private readonly ai: DebriefAiClient,
    private readonly releases: AgentReleaseService,
  ) {}

  /** The GA bundle, or the seed when GA is missing or does not validate. */
  async resolveRelease(
    release?: AgentRelease | null,
  ): Promise<{ release: AgentRelease | null; bundle: DebriefBundle }> {
    const r = release ?? (await this.releases.getGa(DEBRIEF_AGENT_KEY));
    if (r && validateDebriefBundle(r.bundle).length === 0) {
      return { release: r, bundle: r.bundle as unknown as DebriefBundle };
    }
    if (r) {
      this.logger.error(
        `debrief release v${r.version} does not validate; running the seed bundle`,
      );
    }
    return { release: null, bundle: DEBRIEF_SEED_BUNDLE };
  }

  /**
   * Debrief one session. For production modes this is idempotent per
   * session: a second call returns the existing run.
   */
  async run(sessionId: string, opts: RunOptions): Promise<DebriefRun> {
    const now = opts.now ?? Date.now;
    const { release, bundle } = await this.resolveRelease(opts.release);
    const settings = { ...bundle.settings, ...(opts.settingOverrides ?? {}) };

    const created = await this.claim(sessionId, opts, release);
    if (!created) {
      return (await this.runs.findOne({
        where: { scenarioSessionId: sessionId, mode: opts.mode },
      })) as DebriefRun;
    }
    const run = created;
    const startedAt = now();
    const steps: DebriefRunStepRecord[] = [];
    let estimated = 0;
    let rung = FallbackRung.NONE;

    const finish = async (
      status: DebriefRunStatus,
      patch: Partial<DebriefRun> = {},
    ): Promise<DebriefRun> => {
      Object.assign(run, patch, {
        status,
        steps,
        estimatedCostUsd: estimated.toFixed(4),
        fallbackRung: Math.max(run.fallbackRung ?? 0, rung),
        finishedAt: new Date(),
      });
      await this.runs.save(run);
      return run;
    };

    try {
      const session = await this.context.loadSession(sessionId);
      if (!session) {
        return await finish(DebriefRunStatus.SKIPPED, {
          skipReason: 'no_session',
        });
      }
      Object.assign(run, {
        tenantId: session.tenantId,
        language: session.language,
        learnerTurns: session.learnerTurns,
      });
      if (session.learnerTurns === 0) {
        return await finish(DebriefRunStatus.SKIPPED, {
          skipReason: 'too_short',
        });
      }
      const transcript = await this.context.transcript(sessionId);
      if (transcript.length === 0) {
        return await finish(DebriefRunStatus.SKIPPED, {
          skipReason: 'no_transcript',
        });
      }

      const recipe: DebriefRecipe =
        session.learnerTurns >= settings.standardMinLearnerTurns
          ? bundle.recipes[DebriefRecipeKey.STANDARD]
          : bundle.recipes[DebriefRecipeKey.SHORT];
      run.recipeKey = recipe.key;

      let ceiling = settings.runCeilingUsd;
      if (opts.mode !== DebriefRunMode.REPLAY) {
        const mtd = await this.context.monthToDate();
        const d = new Date(now());
        const daysInMonth = new Date(
          d.getUTCFullYear(),
          d.getUTCMonth() + 1,
          0,
        ).getDate();
        const elapsed =
          (d.getUTCDate() - 1 + d.getUTCHours() / 24) / daysInMonth;
        ceiling = effectiveRunCeiling(settings, {
          sessionsThisMonth: mtd.sessions,
          spentThisMonthUsd: mtd.spentUsd,
          monthElapsed: elapsed,
        });
      }
      run.ceilingUsd = ceiling.toFixed(4);
      if (ceiling <= 0) {
        rung = FallbackRung.PERSON_FINISHES;
        return await finish(DebriefRunStatus.NEEDS_PERSON, {
          skipReason: 'monthly_cap',
        });
      }

      const prompt = async (code: string) =>
        opts.promptOverrides?.[code] ??
        (await this.context.promptText(code, bundle.prompts[code] ?? null));
      const stepOf = (s: DebriefStep): RecipeStep | undefined =>
        recipe.steps.find((x) => x.step === s);
      const transcriptChars = transcript.reduce((n, t) => n + t.text.length, 0);

      /** Fits the budget? Reserves it when it does. */
      const reserve = (s: RecipeStep, inputChars: number): number | null => {
        const est = estimateStepCostUsd(s.step, s.model, inputChars + 4000);
        if (estimated + est > ceiling) return null;
        estimated += est;
        return est;
      };
      const deadline = () =>
        run.hasRiskCue ? settings.riskDeadlineMs : settings.deadlineMs;
      const timeLeft = () => deadline() - (now() - startedAt);

      /** One AI step, retried once (on the backup model when there is one). */
      const call = async <T>(
        s: RecipeStep,
        path: string,
        body: Record<string, unknown>,
        est: number,
        round?: number,
      ): Promise<T | null> => {
        const models = [s.model, s.backupModel ?? s.model];
        for (let attempt = 0; attempt < 2; attempt++) {
          const t0 = now();
          try {
            const res = await this.ai.step<T & { model?: string }>(path, {
              ...body,
              model: models[attempt],
              scenario_session_id: sessionId,
            });
            steps.push({
              step: s.step,
              label: s.label,
              status: 'done',
              startedAt: new Date(t0).toISOString(),
              ms: now() - t0,
              model: res.model ?? models[attempt],
              estimatedUsd: Number(est.toFixed(4)),
              round,
              note: attempt > 0 ? 'retried' : null,
            });
            return res;
          } catch (e) {
            const err = e as DebriefStepError;
            steps.push({
              step: s.step,
              label: s.label,
              status: 'failed',
              startedAt: new Date(t0).toISOString(),
              ms: now() - t0,
              model: models[attempt],
              estimatedUsd: Number(est.toFixed(4)),
              round,
              note: `${err.status ?? 'network'}: ${err.message}`.slice(0, 300),
            });
          }
        }
        return null;
      };
      const skipped = (s: RecipeStep | DebriefStep, note: string) => {
        const step = typeof s === 'string' ? s : s.step;
        steps.push({
          step,
          label: typeof s === 'string' ? '' : s.label,
          status: 'skipped',
          startedAt: new Date(now()).toISOString(),
          ms: 0,
          note,
        });
      };

      // 1. Safety reader (mandatory) and Analyst, side by side.
      const safetyStep = stepOf(DebriefStep.SAFETY_READER)!;
      const analystStep = stepOf(DebriefStep.ANALYST);
      const safetyEst = reserve(safetyStep, transcriptChars);
      if (safetyEst === null) {
        rung = FallbackRung.PERSON_FINISHES;
        return await finish(DebriefRunStatus.NEEDS_PERSON, {
          skipReason: 'budget_below_minimum',
        });
      }
      const analystEst = analystStep
        ? reserve(analystStep, transcriptChars)
        : null;
      const [safetyRes, analystRes] = await Promise.all([
        call<{
          risk_cues: SafetyReading['risk_cues'];
          learner_distress: SafetyReading['learner_distress'];
        }>(
          safetyStep,
          'safety-reader',
          {
            transcript,
            language: session.language,
            system_prompt: await prompt(DEBRIEF_PROMPT_CODES.safetyReader),
          },
          safetyEst,
        ),
        analystStep && analystEst !== null
          ? call<{ evidence: Record<string, any> }>(
              analystStep,
              'analyst',
              {
                transcript,
                language: session.language,
                scenario: session.scenario,
                expected_behaviours: session.expectedBehaviours,
                learner_level: session.learnerLevel,
                system_prompt: await prompt(DEBRIEF_PROMPT_CODES.analyst),
              },
              analystEst,
            )
          : Promise.resolve(null),
      ]);
      if (!safetyRes) {
        // Without a safety reading nothing may be published: an empty one
        // would read as a safe session.
        rung = FallbackRung.PERSON_FINISHES;
        return await finish(DebriefRunStatus.NEEDS_PERSON, {
          skipReason: 'safety_reader_failed',
        });
      }
      const safety: SafetyReading = {
        risk_cues: safetyRes.risk_cues ?? [],
        learner_distress: safetyRes.learner_distress ?? [],
      };
      run.hasRiskCue = safety.risk_cues.length > 0;
      run.learnerDistress = safety.learner_distress.length > 0;
      const evidence: Record<string, any> = analystRes?.evidence ?? {};
      if (analystStep && !analystRes) {
        rung = Math.max(rung, FallbackRung.WRITER_AND_CHECKS_ONLY);
        if (analystEst === null) skipped(analystStep, 'budget');
      }
      run.workspace = { safety, evidence };

      // 2. Progress reader, when the learner has history.
      let progress: Record<string, any> | null = null;
      // What the Writer is told about the learner's past, verbatim, so the
      // Evaluator and the judge can tell a supported reference to it from an
      // invented one. Null whenever no progress reading reaches the Writer.
      let history: string | null = null;
      const progressStep = stepOf(DebriefStep.PROGRESS_READER);
      if (progressStep && session.counselorId && analystRes) {
        const past = await this.context.pastWorkOnThis(
          session.counselorId,
          session.tenantId,
          sessionId,
        );
        if (past.length === 0) {
          skipped(progressStep, 'no history');
        } else {
          const est = reserve(progressStep, JSON.stringify(evidence).length);
          if (est === null) {
            rung = Math.max(rung, FallbackRung.SKIP_PROGRESS);
            skipped(progressStep, 'budget');
          } else {
            const res = await call<{ progress: Record<string, any> }>(
              progressStep,
              'progress-reader',
              {
                evidence,
                past_points: past,
                language: session.language,
                system_prompt: await prompt(
                  DEBRIEF_PROMPT_CODES.progressReader,
                ),
              },
              est,
            );
            progress = res?.progress?.items?.length ? res.progress : null;
            if (!res) rung = Math.max(rung, FallbackRung.SKIP_PROGRESS);
            if (progress) {
              history = past
                .map((p) => `${p.date} · ${p.skill}: ${p.point}`)
                .join('\n');
            }
          }
        }
      }

      // 3. Guidance lookup: up to N passages per pivotal moment, no learner words in the query.
      const passages: Array<{ title: string; text: string }> = [];
      const guidanceStep = stepOf(DebriefStep.GUIDANCE_LOOKUP);
      if (guidanceStep && settings.guidancePassagesPerMoment > 0) {
        const moments: Array<{ summary: string }> = (
          evidence.pivotal_moments ?? []
        ).slice(0, 3);
        const t0 = now();
        const seen = new Set<string>();
        let lookups = 0;
        for (const m of moments) {
          if (!m?.summary) continue;
          if (timeLeft() < settings.deadlineMs / 2) {
            rung = Math.max(rung, FallbackRung.ONE_GUIDANCE_LOOKUP);
            break;
          }
          try {
            lookups++;
            const hits = await this.ai.searchGuidance(
              m.summary,
              session.tenantId,
              settings.guidancePassagesPerMoment,
              settings.guidanceMinSimilarity,
            );
            for (const h of hits) {
              if (seen.has(h.chunk_id)) continue;
              seen.add(h.chunk_id);
              passages.push({ title: h.document_title, text: h.text });
            }
          } catch {
            // An empty or unreachable knowledge base never stops a debrief.
            break;
          }
        }
        steps.push({
          step: DebriefStep.GUIDANCE_LOOKUP,
          label: guidanceStep.label,
          status: 'done',
          startedAt: new Date(t0).toISOString(),
          ms: now() - t0,
          note: `${lookups} lookup(s), ${passages.length} passage(s)`,
        });
        run.workspace = { ...run.workspace, passages: [...seen] };
      }
      if (progress) run.workspace = { ...run.workspace, progress, history };

      // 4. Writer.
      const writerStep = stepOf(DebriefStep.WRITER)!;
      const writerInput = {
        evidence,
        safety,
        transcript,
        passages,
        progress,
        language: session.language,
        learner_level: session.learnerLevel,
        short: recipe.shortForm,
        system_prompt: await prompt(DEBRIEF_PROMPT_CODES.writer),
      };
      const writerEst = reserve(writerStep, JSON.stringify(writerInput).length);
      if (writerEst === null) {
        rung = FallbackRung.PERSON_FINISHES;
        return await finish(DebriefRunStatus.NEEDS_PERSON, {
          skipReason: 'budget_below_minimum',
        });
      }
      const written = await call<{ cards: DebriefCards }>(
        writerStep,
        'writer',
        writerInput,
        writerEst,
      );
      if (!written) {
        rung = FallbackRung.PERSON_FINISHES;
        return await finish(DebriefRunStatus.NEEDS_PERSON, {
          skipReason: 'writer_failed',
        });
      }

      // 5. Checks → evaluate ⇄ revise.
      const rubric = await prompt(DEBRIEF_PROMPT_CODES.rubric);
      const evaluatorStep = stepOf(DebriefStep.EVALUATOR)!;
      const reviserStep = stepOf(DebriefStep.REVISER);
      const check = (cards: DebriefCards, round: number) => {
        const t0 = now();
        const fails = runDebriefChecks({
          cards,
          transcript,
          safety,
          language: session.language,
          shortForm: recipe.shortForm,
          hasProgress: !!progress,
        });
        steps.push({
          step: DebriefStep.CHECKS,
          label: stepOf(DebriefStep.CHECKS)?.label ?? '',
          status: 'done',
          startedAt: new Date(t0).toISOString(),
          ms: now() - t0,
          round,
          note: fails.length
            ? fails.map((f) => f.code).join(', ')
            : 'all passed',
        });
        return fails;
      };
      const evaluate = async (
        cards: DebriefCards,
        round: number,
      ): Promise<Evaluation | null> => {
        const debrief = renderCards(cards);
        const est = reserve(
          evaluatorStep,
          transcriptChars + debrief.length + (rubric?.length ?? 0),
        );
        if (est === null) {
          skipped(evaluatorStep, 'budget');
          return null;
        }
        const res = await call<{
          evaluation: {
            dimensions: Array<{ dimension: string; score: number }>;
            hard_fails: Array<{ code: string; evidence: string }>;
            fixes: Array<{ section: string; note: string }>;
          };
        }>(
          evaluatorStep,
          'evaluator',
          {
            transcript,
            debrief,
            rubric,
            history,
            language: session.language,
            learner_level: session.learnerLevel,
          },
          est,
          round,
        );
        if (!res) return null;
        const scores = Object.fromEntries(
          res.evaluation.dimensions.map((d) => [d.dimension, d.score]),
        ) as Partial<Record<DebriefQualityDimension, number>>;
        return {
          overall: computeDebriefOverall(
            scores,
            res.evaluation.hard_fails.length,
          ),
          hardFails: res.evaluation.hard_fails,
          fixes: res.evaluation.fixes ?? [],
          dimensions: res.evaluation.dimensions,
        };
      };
      const meetsBar = (d: Draft) =>
        passesChecks(d) &&
        !!d.evaluation &&
        d.evaluation.hardFails.length === 0 &&
        (d.evaluation.overall ?? 0) >= settings.passScore;

      let current: Draft = {
        cards: written.cards,
        checks: check(written.cards, 0),
        evaluation: null,
        round: 0,
      };
      current.evaluation = await evaluate(current.cards, 0);
      let best = betterDraft(null, current);
      const evaluations: Array<{
        round: number;
        overall: number | null;
        hardFails: string[];
        checks: string[];
      }> = [
        {
          round: 0,
          overall: current.evaluation?.overall ?? null,
          hardFails: current.evaluation?.hardFails.map((h) => h.code) ?? [],
          checks: current.checks.map((c) => c.code),
        },
      ];

      const maxRounds = reviserStep ? recipe.maxRevisionRounds : 0;
      let round = 0;
      while (!meetsBar(best) && round < maxRounds) {
        if (timeLeft() < 30_000) {
          rung = Math.max(
            rung,
            round === 0
              ? FallbackRung.SKIP_FIRST_REVISION
              : FallbackRung.SKIP_SECOND_REVISION,
          );
          skipped(reviserStep!, 'deadline');
          break;
        }
        const critique = [
          ...best.checks.map((c) => ({
            section: c.section,
            note: `${c.code}: ${c.detail}`,
          })),
          ...(best.evaluation?.hardFails ?? []).map((h) => ({
            section: 'whole debrief',
            note: `hard fail ${h.code}: ${h.evidence}`,
          })),
          ...(best.evaluation?.fixes ?? []),
        ];
        const anchored = new Set<number>([
          ...safety.risk_cues.map((c) => c.turn_index),
          ...(best.cards.what_worked ?? []).map((c) => c.turn_index),
          ...(best.cards.work_on_this ?? []).map((c) => c.turn_index),
          ...(best.cards.important_moment
            ? [best.cards.important_moment.turn_index]
            : []),
        ]);
        const excerpts: TranscriptTurn[] = transcript.filter(
          (t) =>
            anchored.has(t.turn_index) ||
            anchored.has(t.turn_index + 1) ||
            anchored.has(t.turn_index - 1),
        );
        const input = {
          draft: best.cards,
          critique,
          evidence,
          excerpts,
          language: session.language,
          system_prompt: await prompt(DEBRIEF_PROMPT_CODES.reviser),
        };
        const est = reserve(reviserStep!, JSON.stringify(input).length);
        if (est === null) {
          rung = Math.max(
            rung,
            round === 0
              ? FallbackRung.SKIP_FIRST_REVISION
              : FallbackRung.SKIP_SECOND_REVISION,
          );
          skipped(reviserStep!, 'budget');
          break;
        }
        round++;
        const revised = await call<{ cards: DebriefCards }>(
          reviserStep!,
          'reviser',
          input,
          est,
          round,
        );
        if (!revised) break;
        current = {
          cards: revised.cards,
          checks: check(revised.cards, round),
          evaluation: null,
          round,
        };
        current.evaluation = await evaluate(current.cards, round);
        evaluations.push({
          round,
          overall: current.evaluation?.overall ?? null,
          hardFails: current.evaluation?.hardFails.map((h) => h.code) ?? [],
          checks: current.checks.map((c) => c.code),
        });
        best = betterDraft(best, current);
      }

      run.workspace = { ...run.workspace, evaluations, bestRound: best.round };
      const patch: Partial<DebriefRun> = {
        cards: best.cards as unknown as Record<string, any>,
        revisionRounds: round,
        checkFailures: best.checks,
        evaluatorOverall:
          best.evaluation?.overall != null
            ? best.evaluation.overall.toFixed(2)
            : null,
        evaluatorHardFails: best.evaluation?.hardFails ?? [],
      };
      if (meetsBar(best))
        return await finish(DebriefRunStatus.PUBLISHED, patch);
      if (
        passesChecks(best) &&
        best.evaluation &&
        !best.evaluation.hardFails.some((h) => h.code === 'missed_risk_cue')
      ) {
        return await finish(DebriefRunStatus.BELOW_BAR, patch);
      }
      rung = FallbackRung.PERSON_FINISHES;
      return await finish(DebriefRunStatus.NEEDS_PERSON, {
        ...patch,
        skipReason: passesChecks(best)
          ? 'not_evaluated_or_risk'
          : 'checks_failed',
      });
    } catch (e) {
      this.logger.error(
        `debrief run ${run.id} for session ${sessionId} failed: ${(e as Error).message}`,
      );
      rung = FallbackRung.PERSON_FINISHES;
      return finish(DebriefRunStatus.FAILED, {
        error: (e as Error).message.slice(0, 1000),
      });
    }
  }

  /**
   * Insert the run row. For a production mode the unique index makes this the
   * claim: a second caller for the same session gets null and reads the first.
   */
  private async claim(
    sessionId: string,
    opts: RunOptions,
    release: AgentRelease | null,
  ): Promise<DebriefRun | null> {
    const row = this.runs.create({
      scenarioSessionId: sessionId,
      mode: opts.mode,
      status: DebriefRunStatus.RUNNING,
      releaseId: release?.id ?? null,
      releaseVersion: release?.version ?? null,
      experimentId: opts.experimentId ?? null,
      arm: opts.arm ?? null,
      startedAt: new Date(),
      steps: [],
      workspace: {},
      checkFailures: [],
      evaluatorHardFails: [],
      estimatedCostUsd: '0',
    });
    if (opts.mode === DebriefRunMode.REPLAY) return this.runs.save(row);
    const res = await this.runs
      .createQueryBuilder()
      .insert()
      .into(DebriefRun)
      .values(row)
      .orIgnore()
      .returning('*')
      .execute();
    const raw = (res.raw as Array<Record<string, any>>)?.[0];
    if (!raw) return null;
    return this.runs.findOneOrFail({ where: { id: raw.id } });
  }
}

export type { DebriefSessionContext };
