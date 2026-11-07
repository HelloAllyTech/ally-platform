import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { In, IsNull, Not, Repository } from 'typeorm';
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
import { DebriefContextRepository } from './debrief-context.repository';

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
  ) {}

  async judge(run: DebriefRun): Promise<RunJudgment | null> {
    if (!run.cards) return null;
    const transcript = await this.context.transcript(run.scenarioSessionId);
    if (!transcript.length) return null;
    const session = await this.context.loadSession(run.scenarioSessionId);
    const rubric = await this.context.promptText(
      DEBRIEF_PROMPT_CODES.rubric,
      null,
    );
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
          history: (run.workspace?.history as string | null) ?? null,
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
    };
    const scores = Object.fromEntries(
      d.dimensions.map((x) => [x.dimension, x.score]),
    ) as Partial<Record<DebriefQualityDimension, number>>;
    const judgment: RunJudgment = {
      model: d.judge_model,
      promptVersion: d.judge_prompt_version,
      overall: computeDebriefOverall(scores, d.hard_fails.length),
      dimensions: d.dimensions.map(({ dimension, score }) => ({
        dimension,
        score,
      })),
      hardFails: d.hard_fails,
      judgedAt: new Date().toISOString(),
    };
    await this.runs.query(
      `UPDATE debrief_runs SET workspace = workspace || jsonb_build_object('judge', $2::jsonb)
        WHERE id = $1`,
      [run.id, JSON.stringify(judgment)],
    );
    run.workspace = { ...run.workspace, judge: judgment };
    return judgment;
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
      },
      order: { createdAt: 'DESC' },
      take: limit * 3,
    });
    let n = 0;
    for (const run of pending) {
      if (n >= limit) break;
      if (run.workspace?.judge || run.mode === 'replay') continue;
      try {
        await this.judge(run);
        n++;
      } catch (e) {
        this.logger.warn(
          `[debrief] judging run ${run.id} failed: ${(e as Error).message}`,
        );
      }
    }
    return n;
  }
}
