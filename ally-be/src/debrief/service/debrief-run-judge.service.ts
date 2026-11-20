import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { In, IsNull, Not, Raw, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  computeDebriefOverall,
  DebriefQualityDimension,
} from '../../analytics/constants/debrief-quality.constants';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  withJudgeSlot,
} from '../../analytics/util/judge-concurrency.util';
import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefCards, renderCards } from '../util/debrief-cards.util';
import { guidancePassage } from '../util/debrief-guidance.util';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefLanguageJudgeService } from './debrief-language-judge.service';
import {
  DebriefRunLogsService,
  JudgeCallLog,
} from './debrief-run-logs.service';

/**
 * Marks run judgments given the Writer's guidance (from 2026-11-11). Without it
 * the judge could never see a protocol, so `contradicts_protocol` could not
 * fire; scores before and after are not one series.
 */
export const RUN_JUDGE_INPUT_VERSION = 'g1';

/** The judge's instructions in the Skills Store (a pinned rule); ally-ai's own text when absent. */
export const DEBRIEF_JUDGE_INSTRUCTIONS_CODE = 'debrief_quality_judge_system';

/**
 * How long a claim to judge a run holds. Longer than the judge call can take
 * (its HTTP timeout is 10 minutes, plus waiting for a judge slot), so a live
 * claim is never taken over; a claim left by a crashed worker frees after it.
 */
export const JUDGE_CLAIM_STALE_MINUTES = 15;
/** A run the judge failed on is tried again after this long, doubling each failure up to the cap. */
export const JUDGE_RETRY_BASE_MINUTES = 15;
export const JUDGE_RETRY_MAX_MINUTES = 24 * 60;

export interface RunJudgment {
  model: string;
  promptVersion: string;
  overall: number | null;
  dimensions: Array<{ dimension: string; score: number }>;
  hardFails: Array<{ code: string; evidence: string }>;
  judgedAt: string;
}

/**
 * The independent judge on the Debrief agent's own debriefs: the same pinned
 * judge, rubric and endpoint that scores today's debriefs, so the two series
 * are comparable. It reads only the published cards and the transcript —
 * never the evidence map or the Evaluator's verdicts. The score is stored on
 * the run (`workspace.judge`), because `debrief_quality_judgment` is keyed one
 * row per session per judge and today's debrief already holds that slot.
 */
/**
 * The WHERE for runs the judge still has to score. TypeORM hands `Raw` the column as `w` and only
 * quotes it when a space, comma or parenthesis follows it: `${w}->>'x'` is left unquoted and Postgres
 * fails with "missing FROM-clause entry", so every `->>` here has a space before it.
 */
export const judgePendingSql = (w: string): string =>
  `NOT (coalesce(${w}, '{}'::jsonb) ? 'judge')
            AND (${w} ->> 'judgeFailedAt' IS NULL
                 OR (${w} ->> 'judgeFailedAt')::timestamptz
                      < now() - make_interval(mins => LEAST(${JUDGE_RETRY_MAX_MINUTES},
                          ${JUDGE_RETRY_BASE_MINUTES}
                          * power(2, LEAST(COALESCE((${w} ->> 'judgeFailures')::int, 1), 8) - 1))::int))`;

@Injectable()
export class DebriefRunJudgeService {
  private readonly logger = LoggerService.getInstance(
    DebriefRunJudgeService.name,
  );

  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly context: DebriefContextRepository,
    private readonly config: AppConfigService,
    private readonly agentLogs: DebriefRunLogsService,
    private readonly language: DebriefLanguageJudgeService,
  ) {}

  /**
   * Score a run. `store: false` scores without writing it back — the baseline
   * job re-judges a sample to measure how much scores move on re-judging,
   * and must not replace the score the KPI reads.
   */
  async judge(
    run: DebriefRun,
    opts: { store?: boolean } = {},
  ): Promise<RunJudgment | null> {
    if (!run.cards) return null;
    const transcript = await this.context.transcript(run.scenarioSessionId);
    if (!transcript.length) return null;
    const session = await this.context.loadSession(run.scenarioSessionId);
    const rubric = await this.context.promptText(
      DEBRIEF_PROMPT_CODES.rubric,
      null,
    );
    const judgeInstructions = await this.context.promptText(
      DEBRIEF_JUDGE_INSTRUCTIONS_CODE,
      null,
    );
    const riskCueDefinition = await this.context.promptText(
      DEBRIEF_PROMPT_CODES.riskCueDefinition,
      null,
    );
    const guidance = await this.guidanceSeen(run);
    // Judging a stored score is exclusive: "Debrief now" and the drain must
    // never both pay for one run, nor overwrite each other's score.
    const store = opts.store !== false;
    if (store && !(await this.claim(run.id))) {
      return this.storedJudgment(run);
    }
    try {
      return await this.callJudge(run, opts, {
        transcript,
        session,
        rubric,
        judgeInstructions,
        riskCueDefinition,
        guidance,
      });
    } finally {
      if (store) await this.releaseClaim(run.id);
    }
  }

  private async callJudge(
    run: DebriefRun,
    opts: { store?: boolean },
    input: {
      transcript: Awaited<ReturnType<DebriefContextRepository['transcript']>>;
      session: Awaited<ReturnType<DebriefContextRepository['loadSession']>>;
      rubric: Awaited<ReturnType<DebriefContextRepository['promptText']>>;
      judgeInstructions: Awaited<
        ReturnType<DebriefContextRepository['promptText']>
      >;
      riskCueDefinition?: string | null;
      guidance: string | null;
    },
  ): Promise<RunJudgment | null> {
    const { transcript, session, rubric, judgeInstructions, guidance } = input;
    // The roleplay's own risk-cue wording when its option has one; else the pinned definition.
    const riskCueDefinition =
      (run.workspace?.riskCueOption?.wording as string | null | undefined) ||
      (input.riskCueDefinition ?? null);
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/debrief-quality/judge`,
        {
          transcript,
          debrief: renderCards(run.cards as unknown as DebriefCards),
          language: run.language ?? session?.language ?? 'en',
          learner_level: session?.learnerLevel ?? null,
          rubric,
          judge_instructions: judgeInstructions,
          risk_cue_definition: riskCueDefinition,
          // What this roleplay expects of the learner: the judge's practice-alignment reads it.
          roleplay_expectations: expectationsFor(session),
          speaker_labels:
            (run.workspace?.speakerLabels as string | undefined) === 'neutral'
              ? 'neutral'
              : 'legacy',
          history: (run.workspace?.history as string | null) ?? null,
          guidance,
          scenario_session_id: run.scenarioSessionId,
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      dimensions: Array<{ dimension: string; score: number }>;
      hard_fails: Array<{ code: string; evidence: string }>;
      log?: JudgeCallLog | null;
    };
    const scores = Object.fromEntries(
      d.dimensions.map((x) => [x.dimension, x.score]),
    ) as Partial<Record<DebriefQualityDimension, number>>;
    const judgment: RunJudgment = {
      model: d.judge_model,
      promptVersion: `${d.judge_prompt_version}+${RUN_JUDGE_INPUT_VERSION}`,
      overall: computeDebriefOverall(scores, d.hard_fails.length),
      dimensions: d.dimensions.map(({ dimension, score }) => ({
        dimension,
        score,
      })),
      hardFails: d.hard_fails,
      judgedAt: new Date().toISOString(),
    };
    if (opts.store === false) return judgment;
    // The first score stands: a run already scored keeps its score.
    const stored = rowsOf(
      await this.runs.query(
        `UPDATE debrief_runs
            SET workspace = (coalesce(workspace, '{}'::jsonb) - 'judgeClaimedAt')
                  || jsonb_build_object('judge', $2::jsonb),
                "judgeOverall" = $3, "judgeModel" = $4, "judgePromptVersion" = $5
          WHERE id = $1 AND (workspace->'judge') IS NULL
          RETURNING id`,
        [
          run.id,
          JSON.stringify(judgment),
          judgment.overall,
          judgment.model.slice(0, 80),
          judgment.promptVersion.slice(0, 80),
        ],
      ),
    );
    if (!stored.length) return this.storedJudgment(run);
    // The independent check in the run's Agent logs, after the run's own entries.
    if (d.log) {
      const versions = judgeInstructions
        ? await this.context
            .currentPromptVersions([DEBRIEF_JUDGE_INSTRUCTIONS_CODE])
            .catch(() => ({}) as Record<string, number>)
        : {};
      await this.agentLogs.recordJudge(
        run,
        d.log,
        {
          code: DEBRIEF_JUDGE_INSTRUCTIONS_CODE,
          version: versions[DEBRIEF_JUDGE_INSTRUCTIONS_CODE] ?? null,
        },
        d.judge_model,
      );
    }
    run.workspace = { ...run.workspace, judge: judgment };
    run.judgeOverall =
      judgment.overall == null ? null : String(judgment.overall);
    run.judgeModel = judgment.model.slice(0, 80);
    run.judgePromptVersion = judgment.promptVersion.slice(0, 80);
    return judgment;
  }

  /**
   * Claim the run for judging in one statement: only a run with no score and
   * no live claim is claimed, so two callers never both judge it. A claim
   * older than {@link JUDGE_CLAIM_STALE_MINUTES} is taken over (its worker died).
   */
  private async claim(runId: string): Promise<boolean> {
    const rows = rowsOf(
      await this.runs.query(
        `UPDATE debrief_runs
            SET workspace = coalesce(workspace, '{}'::jsonb)
                  || jsonb_build_object('judgeClaimedAt', now())
          WHERE id = $1
            AND (workspace->'judge') IS NULL
            AND (workspace->>'judgeClaimedAt' IS NULL
                 OR (workspace->>'judgeClaimedAt')::timestamptz
                      < now() - interval '${JUDGE_CLAIM_STALE_MINUTES} minutes')
          RETURNING id`,
        [runId],
      ),
    );
    return rows.length > 0;
  }

  /** Free the claim (a failed call is retried by the next drain, not in 15 minutes). */
  private async releaseClaim(runId: string): Promise<void> {
    await this.runs
      .query(
        `UPDATE debrief_runs SET workspace = workspace - 'judgeClaimedAt'
          WHERE id = $1 AND (workspace->>'judgeClaimedAt') IS NOT NULL`,
        [runId],
      )
      .catch((e: Error) =>
        this.logger.warn(
          `[debrief] releasing the judge claim on run ${runId} failed: ${e.message}`,
        ),
      );
  }

  /** The score another caller stored, or null while it is still judging. */
  private async storedJudgment(run: DebriefRun): Promise<RunJudgment | null> {
    const fresh = await this.runs.findOne({ where: { id: run.id } });
    const judge = (fresh?.workspace?.judge as RunJudgment | undefined) ?? null;
    if (judge) run.workspace = { ...run.workspace, judge };
    return judge;
  }

  /**
   * The guidance passages the Writer was given, rendered as it saw them, so
   * the judge can tell whether the debrief contradicts or omits a protocol.
   * Loaded by id whatever their status now: an entry archived since still
   * shaped this debrief. Null when the run used none.
   */
  private async guidanceSeen(run: DebriefRun): Promise<string | null> {
    const ids: string[] = Array.isArray(run.workspace?.passages)
      ? run.workspace.passages
      : [];
    if (!ids.length) return null;
    const chunks = await this.runs.manager
      .getRepository(ClChunk)
      .find({ where: { id: In(ids) } });
    const byId = new Map(chunks.map((c) => [c.id, c]));
    const blocks = ids
      .map((id) => byId.get(id))
      .filter((c): c is ClChunk => !!c)
      .map((c) => {
        const { title, text } = guidancePassage(c);
        return `${title}\n${text}`;
      });
    return blocks.length ? blocks.join('\n\n') : null;
  }

  /** Judge production runs that have cards and no score yet. */
  async drain(limit = 20): Promise<number> {
    const pending = await this.runs.find({
      where: {
        status: In([
          DebriefRunStatus.PUBLISHED,
          DebriefRunStatus.BELOW_BAR,
          DebriefRunStatus.NEEDS_PERSON,
        ]),
        cards: Not(IsNull()),
        // Only runs with no score: taking the newest runs and skipping the
        // scored ones starved every older run (one cleared for re-scoring
        // after a rubric change was never reached).
        // And not one that failed lately: a run the judge cannot score would otherwise sit among
        // the newest and, with enough of them, keep every older run from being reached. A failure
        // waits 15 min, then 30, 60 … up to a day before it is tried again.
        workspace: Raw(judgePendingSql),
      },
      order: { createdAt: 'DESC' },
      take: limit * 3,
    });
    let n = 0;
    for (const run of pending) {
      if (n >= limit) break;
      if (run.workspace?.judge || run.mode === 'replay') continue;
      if (claimIsLive(run.workspace?.judgeClaimedAt)) continue;
      try {
        if (await this.judge(run)) n++;
      } catch (e) {
        this.logger.warn(
          `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
        );
        await this.noteFailure(run.id);
      }
    }
    // The language check runs after the quality judge, in its own guard: it can neither fail
    // nor delay the quality judge, and its count is not the drain's (judged runs only).
    await this.language
      .drain(limit)
      .catch((e: Error) =>
        this.logger.warn(`[debrief] language check drain failed: ${e.message}`),
      );
    return n;
  }

  /** Counts a failed attempt, so the drain backs off from this run (see `drain`). */
  private async noteFailure(runId: string): Promise<void> {
    await this.runs
      .query(
        `UPDATE debrief_runs
            SET workspace = coalesce(workspace, '{}'::jsonb)
                  || jsonb_build_object(
                       'judgeFailures', COALESCE((workspace->>'judgeFailures')::int, 0) + 1,
                       'judgeFailedAt', now())
          WHERE id = $1 AND (workspace->'judge') IS NULL`,
        [runId],
      )
      .catch((e: Error) =>
        this.logger.warn(
          `[debrief] noting the judge failure on run ${runId} failed: ${e.message}`,
        ),
      );
  }
}

/** `UPDATE … RETURNING` rows, however the driver shapes them. */
function rowsOf(res: unknown): Array<{ id: string }> {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return Array.isArray(res) ? (res as Array<{ id: string }>) : [];
}

/** True while another caller's claim to judge the run still holds. */
function claimIsLive(claimedAt: unknown): boolean {
  if (typeof claimedAt !== 'string') return false;
  const t = Date.parse(claimedAt);
  return (
    Number.isFinite(t) && Date.now() - t < JUDGE_CLAIM_STALE_MINUTES * 60_000
  );
}

/** The roleplay's expectations for the judge; null when it lists none (today's wording then). */
export function expectationsFor(
  session:
    | {
        helpfulBehaviours?: string[];
        unhelpfulBehaviours?: string[];
        competencies?: Array<{
          name: string;
          helpful: string[];
          unhelpful: string[];
        }>;
      }
    | null
    | undefined,
): {
  helpful_behaviours: string[];
  unhelpful_behaviours: string[];
  competencies: Array<{ name: string; helpful: string[]; unhelpful: string[] }>;
} | null {
  const helpful = session?.helpfulBehaviours ?? [];
  const unhelpful = session?.unhelpfulBehaviours ?? [];
  const competencies = session?.competencies ?? [];
  if (!helpful.length && !unhelpful.length && !competencies.length) return null;
  return {
    helpful_behaviours: helpful,
    unhelpful_behaviours: unhelpful,
    competencies,
  };
}
