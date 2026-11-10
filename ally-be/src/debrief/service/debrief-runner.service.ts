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
  DebriefModelCatalog,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefRun, DebriefRunStepRecord } from '../entity/debrief-run.entity';

/** What a running debrief is doing now, for the learner's "working" panel. */
export interface DebriefProgress {
  step: string;
  round?: number;
  topic?: string;
}
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import {
  checkWeight,
  DebriefCards,
  DebriefCheckFailure,
  ADVISORY_CHECKS,
  keepOfferedPractice,
  withPointIds,
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
import { DebriefPracticeService } from './debrief-practice.service';
import { LanguageSource, detectLanguage } from '../util/detect-language';
import {
  modelsToTry,
  recordModelFailure,
  recordModelSuccess,
} from '../util/model-circuit';
import { ContextRetrievalService } from '../../context-library/service/context-retrieval.service';
import { guidancePassage, guidanceSearch } from '../util/debrief-guidance.util';
import { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { LlmModelService } from '../../llm/service/llm-model.service';
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

/**
 * How a step is explained in the Console's run view (reasoning out loud):
 * why the runner ran it, what it was given, how to say in one line what it
 * produced, and, for a step whose model gives no rationale, what to say
 * instead.
 */
interface StepExplain<T> {
  why?: string;
  inputs?: string[];
  summarise?: (res: T) => string;
  reasoning?: (res: T) => string | null;
}

/** An optional read that can never fail the run: any error gives the fallback. */
async function orFallback<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** A summary that cannot fail the run: an odd answer shape gives no line. */
function safeSummary<T>(
  summarise: ((res: T) => string) | undefined,
  res: T,
): string | null {
  if (!summarise) return null;
  try {
    return summarise(res).slice(0, 300) || null;
  } catch {
    return null;
  }
}

/** The runner's reason for a skipped step, by the note it records. */
const SKIP_WHY: Record<string, string> = {
  budget: 'Skipped: not enough of the run budget was left for it.',
  deadline: 'Skipped: too little time was left before the deadline.',
  'no history': 'Skipped: this learner has no earlier debriefs to follow up.',
};

/** "1 thing" / "3 things": counts read as words in the run view. */
const n = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The Analyst's evidence map, in one line. */
export function evidenceSummary(evidence: Record<string, any>): string {
  const b: Array<{ observation?: string; opportunity?: boolean }> =
    Array.isArray(evidence?.behaviours) ? evidence.behaviours : [];
  const seen = (o: string) =>
    b.filter((x) => x?.opportunity !== false && x?.observation === o).length;
  const moments = Array.isArray(evidence?.pivotal_moments)
    ? evidence.pivotal_moments.length
    : 0;
  return (
    `${n(b.length, 'skill')} read: ${seen('observed')} observed, ` +
    `${seen('partial')} partial, ${seen('missed')} missed; ` +
    `${n(moments, 'pivotal moment')}`
  );
}

/** A draft's cards, in one line. */
export function cardsSummary(cards: Partial<DebriefCards> | undefined): string {
  const worked = cards?.what_worked?.length ?? 0;
  const work = cards?.work_on_this?.length ?? 0;
  return [
    cards?.important_moment ? 'an important moment' : 'no important moment',
    n(worked, 'strength'),
    n(work, 'point to work on', 'points to work on'),
    cards?.practise_next ? 'Practise next' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What code found in the Safety reader's reading (its model is pinned and gives no rationale). */
export function safetyNarration(safety: SafetyReading): string {
  const cues = safety.risk_cues;
  if (cues.length === 0 && safety.learner_distress.length === 0) {
    return 'No client risk cues and no sign of the learner’s own distress.';
  }
  const parts: string[] = [];
  if (cues.length) {
    parts.push(
      `${n(cues.length, 'client risk cue')}: ` +
        cues
          .map(
            (c) =>
              `turn ${c.turn_index} (${String(c.category).replace(/_/g, ' ')}; ` +
              `learner ${String(c.learner_response).replace(/_/g, ' ')})`,
          )
          .join(', ') +
        '. The debrief must cover every one.',
    );
  }
  if (safety.learner_distress.length) {
    parts.push(
      `The learner’s own distress at turn ` +
        safety.learner_distress.map((d) => d.turn_index).join(', ') +
        ': the debrief opens with support first.',
    );
  }
  return parts.join(' ');
}

/** Why a run ended before a draft was judged, by its skip reason. */
const END_WHY: Record<string, string> = {
  no_session: 'Stopped: the session could not be found.',
  too_short: 'No debrief: the learner said nothing in the session.',
  no_transcript: 'No debrief: the session has no transcript.',
  monthly_cap:
    'Held for a person: this month’s debrief budget is spent, so no run could start.',
  budget_below_minimum:
    'Held for a person: the run budget could not cover the minimum steps.',
  safety_reader_failed:
    'Held for a person: the safety reading failed, and nothing is published without one.',
  writer_failed: 'Held for a person: the Writer failed on both of its models.',
};

/** Why the Reviser ran: what kept the best draft below the bar. */
function revisionWhy(best: Draft, passScore: number): string {
  const blocking = best.checks.filter((c) => !ADVISORY_CHECKS.has(c.code));
  const reasons = [
    blocking.length
      ? `it failed ${blocking.map((c) => c.code).join(', ')}`
      : null,
    best.evaluation?.hardFails.length
      ? `the Evaluator found ${best.evaluation.hardFails.map((h) => h.code).join(', ')}`
      : null,
    best.evaluation?.overall != null && best.evaluation.overall < passScore
      ? `it scored ${best.evaluation.overall.toFixed(1)} (the bar is ${passScore})`
      : null,
    !best.evaluation ? 'it could not be scored' : null,
  ].filter(Boolean);
  return `Revising round ${best.round} because ${reasons.join(', and ') || 'it is below the bar'}.`;
}

/** A draft is publishable when it passes every check. */
const passesChecks = (d: Draft) =>
  d.checks.every((c) => ADVISORY_CHECKS.has(c.code));

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
    private readonly practice: DebriefPracticeService,
    private readonly guidance: ContextRetrievalService,
    private readonly llmModels: LlmModelService,
  ) {}

  /**
   * The LLM catalog as the release check reads it. Its service falls back to
   * the in-code list when the table is unreadable, so a database hiccup
   * narrows what may run rather than failing the run.
   */
  async modelCatalog(): Promise<DebriefModelCatalog> {
    const [steps, reply] = await Promise.all([
      this.llmModels.getModels(LlmRuntime.ALLY_AI),
      this.llmModels.getModels(LlmRuntime.ALLY_BE),
    ]);
    return {
      steps: new Set(steps.map((m) => m.model)),
      reply: new Set(reply.map((m) => m.model)),
    };
  }

  /** The GA bundle, or the seed when GA is missing or does not validate. */
  async resolveRelease(
    release?: AgentRelease | null,
  ): Promise<{ release: AgentRelease | null; bundle: DebriefBundle }> {
    const r = release ?? (await this.releases.getGa(DEBRIEF_AGENT_KEY));
    const problems = r
      ? validateDebriefBundle(r.bundle, await this.modelCatalog())
      : [];
    if (r && problems.length === 0) {
      return { release: r, bundle: r.bundle as unknown as DebriefBundle };
    }
    if (r) {
      this.logger.error(
        `debrief release v${r.version} does not validate (${problems.join('; ')}); running the seed bundle`,
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
      // A run that ended early still says why, in the same place as one that
      // reached a decision about a draft.
      const ended =
        patch.skipReason ??
        (status === DebriefRunStatus.FAILED ? 'failed' : null);
      if (ended && !run.workspace?.decision) {
        run.workspace = {
          ...run.workspace,
          decision: {
            status,
            round: null,
            why:
              END_WHY[ended] ??
              (status === DebriefRunStatus.FAILED
                ? 'Failed: an unexpected error stopped the run (see the error).'
                : ended),
          },
        };
      }
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
      // The Console lists a running debrief with its organisation and
      // language, not only once it finishes. Never awaited, never fails it.
      try {
        void Promise.resolve(
          this.runs.update(run.id, {
            tenantId: session.tenantId,
            language: session.language,
            learnerTurns: session.learnerTurns,
          } as Partial<DebriefRun>),
        ).catch(() => undefined);
      } catch {
        // The finish writes them anyway.
      }
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
      // v9 FR-39: no recorded language → read it from what the learner wrote,
      // and say so on the run (the Console counts these per organisation).
      let languageSource: LanguageSource = 'recorded';
      if (!session.languageRecorded) {
        const detected = detectLanguage(
          transcript.filter((t) => t.role === 'counselor').map((t) => t.text),
        );
        session.language = detected.language;
        languageSource = detected.source;
        run.language = detected.language;
      }
      run.workspace = { ...run.workspace, languageSource };

      const recipe: DebriefRecipe =
        session.learnerTurns < settings.standardMinLearnerTurns
          ? bundle.recipes[DebriefRecipeKey.SHORT]
          : // A release from before Case and Assessment runs Standard.
            (bundle.recipes[
              session.assessment
                ? DebriefRecipeKey.ASSESSMENT
                : session.inCase
                  ? DebriefRecipeKey.CASE
                  : DebriefRecipeKey.STANDARD
            ] ?? bundle.recipes[DebriefRecipeKey.STANDARD]);
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

      /**
       * What the learner's "working" panel says now (v9 FR-27). Written as a
       * step starts, so it names what is happening, not what just finished.
       * Never awaited and never fails the run.
       */
      const announce = (p: DebriefProgress) => {
        try {
          void Promise.resolve(
            this.runs.query(
              `UPDATE debrief_runs
                  SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{liveProgress}', $2::jsonb),
                      "hasRiskCue" = $3
                WHERE id = $1 AND status = 'running'`,
              [run.id, JSON.stringify(p), !!run.hasRiskCue],
            ),
          ).catch(() => undefined);
        } catch {
          // The panel stays on its last line; the debrief carries on.
        }
      };

      /** What is left of the ceiling once everything reserved so far is spent. */
      const budgetLeft = () =>
        Number(Math.max(0, ceiling - estimated).toFixed(4));

      /**
       * One AI step, retried once (on the backup model when there is one).
       * `explain` is the reasoning-out-loud record: why the runner ran it,
       * what it was given, and how to say in one line what came back.
       */
      const call = async <T>(
        s: RecipeStep,
        path: string,
        body: Record<string, unknown>,
        est: number,
        round?: number,
        explain: StepExplain<T> = {},
      ): Promise<T | null> => {
        announce({ step: s.step, ...(round ? { round } : {}) });
        // A model whose breaker is open goes after its backup, not before.
        const models = modelsToTry(s.model, s.backupModel);
        for (let attempt = 0; attempt < 2; attempt++) {
          const t0 = now();
          try {
            const res = await this.ai.step<
              T & { model?: string; reasoning?: string }
            >(path, {
              ...body,
              model: models[attempt],
              scenario_session_id: sessionId,
            });
            if (models[attempt]) recordModelSuccess(models[attempt]!);
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
              why: explain.why ?? null,
              inputs: explain.inputs ?? [],
              reasoning:
                explain.reasoning?.(res) ??
                (typeof res.reasoning === 'string' && res.reasoning.trim()
                  ? res.reasoning.trim().slice(0, 2000)
                  : null),
              output: safeSummary(explain.summarise, res),
              budgetLeftUsd: budgetLeft(),
            });
            return res;
          } catch (e) {
            const err = e as DebriefStepError;
            if (models[attempt]) recordModelFailure(models[attempt]!);
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
              why:
                attempt === 0
                  ? (explain.why ?? null)
                  : 'Retried once after the first attempt failed.',
              inputs: explain.inputs ?? [],
              budgetLeftUsd: budgetLeft(),
            });
          }
        }
        return null;
      };
      const skipped = (
        s: RecipeStep | DebriefStep,
        note: string,
        why?: string,
      ) => {
        const step = typeof s === 'string' ? s : s.step;
        steps.push({
          step,
          label: typeof s === 'string' ? '' : s.label,
          status: 'skipped',
          startedAt: new Date(now()).toISOString(),
          ms: 0,
          note,
          why: why ?? SKIP_WHY[note] ?? null,
          budgetLeftUsd: budgetLeft(),
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
      // The live detector's record is a second opinion for the Analyst (v9
      // FR-17). It never blocks a debrief: unreadable means none.
      const liveDetections = analystStep
        ? await orFallback(
            () => this.context.liveDetections(sessionId, session.scenarioId),
            [],
          )
        : [];
      if (liveDetections.length) {
        run.workspace = { ...run.workspace, liveDetections };
      }
      // A case's memory so far: the Analyst returns it updated (v9 FR-4, the
      // memory the next session of the case reads), the Writer keeps to it.
      const caseMemory =
        recipe.key === DebriefRecipeKey.CASE
          ? await orFallback(() => this.context.caseMemory(session.id), null)
          : null;
      if (caseMemory) run.workspace = { ...run.workspace, caseMemory };
      const analystEst = analystStep
        ? reserve(analystStep, transcriptChars)
        : null;
      const turnsLine = `the transcript (${n(transcript.length, 'turn')})`;
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
          undefined,
          {
            why: 'Always runs first: nothing is published without a safety reading.',
            inputs: [turnsLine],
            reasoning: (r) =>
              safetyNarration({
                risk_cues: r.risk_cues ?? [],
                learner_distress: r.learner_distress ?? [],
              }),
            summarise: (r) =>
              `${n(r.risk_cues?.length ?? 0, 'risk cue')}, ` +
              `${n(r.learner_distress?.length ?? 0, 'sign', 'signs')} of the learner’s own distress`,
          },
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
                live_detections: liveDetections,
                case_memory: caseMemory,
                system_prompt: await prompt(DEBRIEF_PROMPT_CODES.analyst),
              },
              analystEst,
              undefined,
              {
                why: 'Builds the evidence map the Writer writes from.',
                inputs: [
                  turnsLine,
                  'the scenario',
                  n(session.expectedBehaviours.length, 'expected behaviour'),
                  ...(caseMemory ? ['the case memory'] : []),
                  ...(liveDetections.length
                    ? [
                        `the live detector’s record (${liveDetections.filter((d) => d.detected).length} of ${liveDetections.length} detected)`,
                      ]
                    : []),
                ],
                summarise: (r) => evidenceSummary(r.evidence),
              },
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
      run.workspace = { ...run.workspace, safety, evidence };

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
              undefined,
              {
                why: `This learner has ${n(past.length, 'earlier Work-on-this point')} to follow up.`,
                inputs: ['the evidence map', n(past.length, 'past point')],
                summarise: (r) =>
                  r.progress?.items?.length
                    ? (
                        r.progress.items as Array<{
                          skill?: string;
                          trend?: string;
                        }>
                      )
                        .map(
                          (i) =>
                            `${i.skill}: ${String(i.trend ?? '').replace(/_/g, ' ')}`,
                        )
                        .join('; ')
                    : 'nothing to follow up this time',
              },
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
        // The skill that mattered most names what the lookup is about.
        const topic = [...(evidence.behaviours ?? [])]
          .filter((b: { opportunity?: boolean }) => b?.opportunity !== false)
          .sort(
            (a: { importance?: number }, b: { importance?: number }) =>
              (b.importance ?? 0) - (a.importance ?? 0),
          )[0]?.skill;
        announce({
          step: DebriefStep.GUIDANCE_LOOKUP,
          ...(typeof topic === 'string' && topic.trim()
            ? { topic: topic.trim().slice(0, 60) }
            : {}),
        });
        const seen = new Set<string>();
        let lookups = 0;
        let stopped: string | null = null;
        for (const m of moments) {
          if (!m?.summary) continue;
          if (timeLeft() < settings.deadlineMs / 2) {
            rung = Math.max(rung, FallbackRung.ONE_GUIDANCE_LOOKUP);
            stopped = 'Stopped early to keep time for writing.';
            break;
          }
          try {
            lookups++;
            // Debrief Guidance, as the learner's organisation may read it
            // (Context Library, `debrief` use case: logged, its query withheld
            // from every read surface). "No confident match" is nothing, not a
            // weak passage for the Writer to lean on.
            const { results, noConfidentMatch } = await this.guidance.search(
              guidanceSearch(
                m.summary,
                session.tenantId,
                settings.guidancePassagesPerMoment,
                session.id,
              ),
            );
            for (const { chunk } of noConfidentMatch ? [] : results) {
              if (seen.has(chunk.id)) continue;
              seen.add(chunk.id);
              passages.push(guidancePassage(chunk));
            }
          } catch {
            // Empty or unreachable guidance never stops a debrief.
            stopped = 'Guidance could not be reached; writing without it.';
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
          why: moments.length
            ? `Looks up practice guidance for the session’s ${n(Math.min(moments.length, 3), 'pivotal moment')}.`
            : 'No pivotal moments to look guidance up for.',
          inputs: [
            'each moment’s summary in the Analyst’s words (never the learner’s)',
          ],
          reasoning:
            [
              typeof topic === 'string' && topic.trim()
                ? `Led by the skill that mattered most: ${topic.trim().slice(0, 60)}.`
                : null,
              lookups && !passages.length
                ? 'Nothing matched confidently, so the Writer gets no guidance rather than a weak match.'
                : null,
              stopped,
            ]
              .filter(Boolean)
              .join(' ') || null,
          output: `${n(lookups, 'lookup')}, ${n(passages.length, 'passage')} kept${
            passages.length
              ? `: ${passages
                  .map((p) => p.title)
                  .slice(0, 3)
                  .join('; ')}`
              : ''
          }`,
          budgetLeftUsd: budgetLeft(),
        });
        run.workspace = { ...run.workspace, passages: [...seen] };
      }
      if (progress) run.workspace = { ...run.workspace, progress, history };

      // 4. Writer, with the roleplays "Practise this next" may point to.
      const practiceOptions = await this.practice.optionsFor(
        session.counselorId,
        session.tenantId,
      );
      const offered = new Set(practiceOptions.map((o) => o.id));
      const writerStep = stepOf(DebriefStep.WRITER)!;
      // How the organisation's other trainees did on this roleplay (v9 FR-17):
      // only for 5 or more of them, in words, and never a reason to fail.
      const cohort = await orFallback(
        () => this.context.cohortStats(session),
        null,
      );
      if (cohort) run.workspace = { ...run.workspace, cohort };
      const writerInput = {
        practice_options: practiceOptions,
        case_memory: caseMemory,
        cohort,
        assessment: recipe.key === DebriefRecipeKey.ASSESSMENT,
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
        undefined,
        {
          why: recipe.shortForm
            ? 'Writes a short debrief: the session had few learner turns.'
            : `Writes the cards from the evidence (${recipe.key} recipe).`,
          inputs: [
            analystRes
              ? 'the evidence map'
              : 'no evidence map (the Analyst did not run)',
            'the safety reading',
            turnsLine,
            ...(passages.length
              ? [n(passages.length, 'guidance passage')]
              : []),
            ...(progress ? ['the progress reading'] : []),
            ...(caseMemory ? ['the case memory'] : []),
            ...(cohort
              ? ['how other trainees did on this roleplay (5 or more)']
              : []),
            n(practiceOptions.length, 'roleplay', 'roleplays') +
              ' Practise next may point to',
          ],
          summarise: (r) => cardsSummary(r.cards),
        },
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
          why: 'The rule checks run on every draft: quotes, risk cues, length, language, no scores.',
          reasoning: fails.length
            ? fails
                .slice(0, 6)
                .map((f) => `${f.section}: ${f.detail}`)
                .join(' · ')
            : null,
          output: fails.length
            ? `${n(fails.length, 'check')} failed${
                fails.every((f) => ADVISORY_CHECKS.has(f.code))
                  ? ' (advisory only; still publishable)'
                  : ''
              }`
            : 'every check passed',
          budgetLeftUsd: budgetLeft(),
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
          {
            why:
              round === 0
                ? 'Scores the first draft against the rubric before anything is published.'
                : `Scores revision ${round} against the rubric.`,
            inputs: [
              round === 0 ? 'the draft' : `revision ${round}`,
              turnsLine,
              'the rubric',
              ...(history ? ['the learner’s past points'] : []),
            ],
            summarise: (r) => {
              const overall = computeDebriefOverall(
                Object.fromEntries(
                  r.evaluation.dimensions.map((d) => [d.dimension, d.score]),
                ) as Partial<Record<DebriefQualityDimension, number>>,
                r.evaluation.hard_fails.length,
              );
              return [
                overall != null
                  ? `${overall.toFixed(1)} overall`
                  : 'no overall score',
                r.evaluation.hard_fails.length
                  ? `hard fails: ${r.evaluation.hard_fails.map((h) => h.code).join(', ')}`
                  : 'no hard fail',
                n(r.evaluation.fixes?.length ?? 0, 'fix note'),
              ].join('; ');
            },
          },
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
      // Every round's cards and the critique that produced it, so the run
      // view can show what changed between drafts and why.
      const drafts: Array<{
        round: number;
        cards: DebriefCards;
        critique: Array<{ section: string; note: string }>;
      }> = [{ round: 0, cards: written.cards, critique: [] }];
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
          {
            why: revisionWhy(best, settings.passScore),
            inputs: [
              `the best draft so far (round ${best.round})`,
              n(critique.length, 'critique note'),
              'the evidence map',
              n(excerpts.length, 'transcript excerpt'),
            ],
            summarise: (r) => cardsSummary(r.cards),
          },
        );
        if (!revised) break;
        drafts.push({ round, cards: revised.cards, critique });
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

      run.workspace = {
        ...run.workspace,
        evaluations,
        bestRound: best.round,
        drafts,
      };
      const patch: Partial<DebriefRun> = {
        cards: withPointIds(
          keepOfferedPractice(best.cards, offered),
        ) as unknown as Record<string, any>,
        revisionRounds: round,
        checkFailures: best.checks,
        evaluatorOverall:
          best.evaluation?.overall != null
            ? best.evaluation.overall.toFixed(2)
            : null,
        evaluatorHardFails: best.evaluation?.hardFails ?? [],
      };
      const decide = (status: DebriefRunStatus, why: string) => {
        run.workspace = {
          ...run.workspace,
          decision: { status, round: best.round, why },
        };
      };
      const scored =
        best.evaluation?.overall != null
          ? `scored ${best.evaluation.overall.toFixed(1)}`
          : 'was not scored';
      if (meetsBar(best)) {
        decide(
          DebriefRunStatus.PUBLISHED,
          `Published round ${best.round}: it passed every check and ${scored} with no hard fail (the bar is ${settings.passScore}).`,
        );
        return await finish(DebriefRunStatus.PUBLISHED, patch);
      }
      if (
        passesChecks(best) &&
        best.evaluation &&
        !best.evaluation.hardFails.some((h) => h.code === 'missed_risk_cue')
      ) {
        decide(
          DebriefRunStatus.BELOW_BAR,
          `Published round ${best.round} below the bar and sent it to review: it passed every check but ${scored}` +
            (best.evaluation.hardFails.length
              ? ` with ${best.evaluation.hardFails.map((h) => h.code).join(', ')}`
              : '') +
            (round >= maxRounds
              ? ', and no revision rounds were left.'
              : ', and there was no budget or time for another revision.'),
        );
        return await finish(DebriefRunStatus.BELOW_BAR, patch);
      }
      rung = FallbackRung.PERSON_FINISHES;
      decide(
        DebriefRunStatus.NEEDS_PERSON,
        passesChecks(best)
          ? best.evaluation
            ? 'Held for a person: the Evaluator found a missed risk cue, which is never published automatically.'
            : 'Held for a person: no draft could be scored, so nothing was published automatically.'
          : `Held for a person: the best draft still failed ${best.checks
              .filter((c) => !ADVISORY_CHECKS.has(c.code))
              .map((c) => c.code)
              .join(', ')}.`,
      );
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
