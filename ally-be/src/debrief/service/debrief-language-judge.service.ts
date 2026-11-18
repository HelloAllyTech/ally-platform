import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { DataSource, Repository } from 'typeorm';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../../analytics/constants/judge-scheduling.constants';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  withJudgeSlot,
} from '../../analytics/util/judge-concurrency.util';
import { JudgeAttemptRepository } from '../../analytics/repository/judge-attempt.repository';
import { judgeAttemptGate } from '../../analytics/util/judge-attempts.util';
import {
  DEBRIEF_LANGUAGE_ERROR_TYPES,
  DebriefLanguageFinding,
  DebriefLanguageJudgment,
} from '../entity/debrief-language-judgment.entity';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefCards } from '../util/debrief-cards.util';
import {
  citedTurns,
  languageSections,
} from '../util/debrief-language-sections.util';
import { DebriefContextRepository } from './debrief-context.repository';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { DEBRIEF_AGENT_KEY } from '../../common/constants/debrief-agent.constants';
import { createHash } from 'crypto';

/**
 * Whether a run is in the language-check sample: the first 32 bits of the md5 of its id, as a
 * share of 2^32 - 1, under the rate. The same formula runs in SQL (`pending`), so a retry, a
 * re-judge and the drain's selection always decide the same way.
 */
export function inLanguageSample(runId: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const h = parseInt(
    createHash('md5').update(runId).digest('hex').slice(0, 8),
    16,
  );
  return h / 4294967295 < rate;
}

/** The judge's rubric in the Skills Store (a pinned rule); ally-ai's own text when absent. */
export const DEBRIEF_LANGUAGE_RUBRIC_CODE = 'debrief_language_judge_rubric';

/**
 * The language check on a debrief: is its own text written well in the session
 * language? A second, separate judgment beside the quality judge: it has its own
 * table, its own ledger family and its own model, and nothing it does can fail
 * or delay the quality judge (the drain calls it last, inside its own guard).
 *
 * It reads only the visible debrief text, the language label and config, and
 * the transcript turns the cards cite. It stores findings, never a score.
 */
@Injectable()
export class DebriefLanguageJudgeService {
  private readonly logger = LoggerService.getInstance(
    DebriefLanguageJudgeService.name,
  );

  constructor(
    @InjectRepository(DebriefLanguageJudgment)
    private readonly judgments: Repository<DebriefLanguageJudgment>,
    private readonly dataSource: DataSource,
    private readonly context: DebriefContextRepository,
    private readonly config: AppConfigService,
    private readonly attempts: JudgeAttemptRepository,
    private readonly releases: AgentReleaseService,
  ) {}

  /** The release's sample rate (1 when unset or unreadable: check every debrief). */
  async sampleRate(): Promise<number> {
    try {
      const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
      const v = (
        ga?.bundle as { settings?: { languageJudgeSampleRate?: unknown } }
      )?.settings?.languageJudgeSampleRate;
      return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Check one run's debrief. Idempotent: a run that already has a result is
   * returned as it is and costs nothing, unless `force` asks for a re-judge
   * (which replaces the row, so there is one answer per run). Null when there
   * is nothing to judge or the judge gave no usable answer; neither is stored
   * as "no problems".
   */
  async judge(
    run: DebriefRun,
    opts: { force?: boolean } = {},
  ): Promise<DebriefLanguageJudgment | null> {
    if (!run.cards) return null;
    if (!opts.force) {
      const existing = await this.judgments.findOne({
        where: { runId: run.id },
      });
      if (existing) return existing;
    }
    const cards = run.cards as unknown as DebriefCards;
    const sections = languageSections(cards);
    if (!sections.length) return null;

    const transcript = await this.context.transcript(run.scenarioSessionId);
    const language = run.language || 'en';
    const lang = await this.languageFacts(language);
    const rubric = await this.context.promptText(
      DEBRIEF_LANGUAGE_RUBRIC_CODE,
      null,
    );
    const allowed = await this.context.providerAllowlist(run.tenantId);
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/debrief-language/judge`,
        {
          sections,
          language,
          language_config: lang,
          quoted_turns: citedTurns(cards, transcript),
          rubric,
          scenario_session_id: run.scenarioSessionId,
          // A learner's text never goes to a provider the organisation does not allow: ally-ai
          // skips the judge when its own provider is not in this list.
          allowed_providers: allowed,
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
      answered: boolean;
      skipped?: string;
      findings: DebriefLanguageFinding[];
    };
    if (d.skipped) {
      // Not an error and not a result: this organisation does not allow the judge's provider, so
      // the debrief is simply not language-checked (the ledger keeps the run from being retried hot).
      await this.attempts.recordFailure(
        JudgeAttemptFamily.DEBRIEF_LANGUAGE,
        run.id,
        run.tenantId,
        JudgeAttemptOutcome.EMPTY,
        `not checked: ${d.skipped}`,
      );
      return null;
    }
    if (!d.answered) {
      await this.attempts.recordFailure(
        JudgeAttemptFamily.DEBRIEF_LANGUAGE,
        run.id,
        run.tenantId,
        JudgeAttemptOutcome.EMPTY,
        'language judge returned no usable answer',
      );
      return null;
    }
    const findings = (d.findings ?? []).filter((f) =>
      (DEBRIEF_LANGUAGE_ERROR_TYPES as readonly string[]).includes(
        f.error_type,
      ),
    );
    const types = [...new Set(findings.map((f) => f.error_type))];
    // One row per run. A normal call never overwrites (two callers racing both
    // paid, but the first answer stands); only a deliberate re-judge replaces it.
    await this.dataSource.query(
      `INSERT INTO debrief_language_judgments
         ("runId", "language", "judgeModel", "judgePromptVersion", "findings",
          "findingCount", "types", "judgedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::text[], now())
       ON CONFLICT ("runId") DO ${
         opts.force
           ? `UPDATE SET "language" = EXCLUDED."language",
              "judgeModel" = EXCLUDED."judgeModel",
              "judgePromptVersion" = EXCLUDED."judgePromptVersion",
              "findings" = EXCLUDED."findings",
              "findingCount" = EXCLUDED."findingCount",
              "types" = EXCLUDED."types", "judgedAt" = now(), "updatedAt" = now()`
           : 'NOTHING'
       }`,
      [
        run.id,
        language,
        d.judge_model.slice(0, 80),
        d.judge_prompt_version.slice(0, 80),
        JSON.stringify(findings),
        findings.length,
        types,
      ],
    );
    await this.attempts.clear(JudgeAttemptFamily.DEBRIEF_LANGUAGE, run.id);
    return this.judgments.findOne({ where: { runId: run.id } });
  }

  /** Runs with cards and no language check yet, newest first, skipping ones the ledger says to leave. */
  async pending(limit: number, rate = 1): Promise<DebriefRun[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const rateParam = p(rate);
    const statuses = [
      DebriefRunStatus.PUBLISHED,
      DebriefRunStatus.BELOW_BAR,
      DebriefRunStatus.NEEDS_PERSON,
    ];
    const ids: Array<{ id: string }> = await this.dataSource.query(
      `SELECT r.id FROM debrief_runs r
        WHERE r.status = ANY(${p(statuses)}::text[])
          AND r.cards IS NOT NULL AND r.mode <> 'replay'
          AND NOT EXISTS (SELECT 1 FROM debrief_language_judgments j WHERE j."runId" = r.id)
          AND (${rateParam}::float8 >= 1 OR (('x' || substr(md5(r.id::text), 1, 8))::bit(32)::bigint / 4294967295.0) < ${rateParam}::float8)
          AND ${judgeAttemptGate(JudgeAttemptFamily.DEBRIEF_LANGUAGE, 'r.id', p)}
        ORDER BY r."createdAt" DESC
        LIMIT ${p(limit)}`,
      params,
    );
    if (!ids.length) return [];
    return this.dataSource
      .getRepository(DebriefRun)
      .createQueryBuilder('r')
      .whereInIds(ids.map((i) => i.id))
      .orderBy('r.createdAt', 'DESC')
      .getMany();
  }

  /** Check up to `limit` runs. Never throws: a failure is counted on the ledger and the next run goes on. */
  async drain(limit = 5): Promise<number> {
    let n = 0;
    let runs: DebriefRun[] = [];
    try {
      runs = await this.pending(limit, await this.sampleRate());
    } catch (e) {
      this.logger.warn(
        `[debrief] listing runs for the language check failed: ${(e as Error).message}`,
      );
      return 0;
    }
    for (const run of runs) {
      try {
        if (await this.judge(run)) n++;
      } catch (e) {
        this.logger.warn(
          `[debrief] language check of run ${run.id} failed: ${(e as Error).message}`,
        );
        await this.attempts.recordFailure(
          JudgeAttemptFamily.DEBRIEF_LANGUAGE,
          run.id,
          run.tenantId,
          JudgeAttemptOutcome.FAILED,
          e,
        );
      }
    }
    return n;
  }

  /** Label, variety, diglossia and code-switch partners of a session language (all optional). */
  private async languageFacts(code: string): Promise<Record<string, unknown>> {
    const [row] = await this.dataSource.query(
      `SELECT label, "evalConfig" AS cfg FROM languages
        WHERE value = $1 OR value LIKE $1 || '-%'
        ORDER BY (value = $1) DESC LIMIT 1`,
      [code],
    );
    const cfg = (row?.cfg ?? {}) as Record<string, unknown>;
    return {
      language_label: row?.label ?? null,
      target_variety:
        typeof cfg.targetVariety === 'string' ? cfg.targetVariety : null,
      diglossia: typeof cfg.diglossia === 'boolean' ? cfg.diglossia : null,
      code_switch_partners: Array.isArray(cfg.codeSwitchPartners)
        ? cfg.codeSwitchPartners
        : [],
    };
  }
}
