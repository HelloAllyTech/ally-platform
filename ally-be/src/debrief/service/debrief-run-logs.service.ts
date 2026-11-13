import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { LoggerService } from '../../logger/logger.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunLog } from '../entity/debrief-run-log.entity';
import { DebriefRunLogKind } from '../enum/debrief-run.enum';

/** Stands in for the system prompt's text in a logged message (ally-ai `agent_logs.py`). */
export const SYSTEM_PROMPT_MARKER = '{{system_prompt}}';

/** One entry as ally-ai's graph returns it (`logs` on the run response). */
export interface GraphLogEntry {
  seq: number;
  kind: 'model' | 'code';
  step: string;
  round?: number | null;
  startedAt?: string | null;
  ms?: number | null;
  model?: string | null;
  fallbackModel?: string | null;
  promptCode?: string | null;
  promptInlined?: boolean;
  input?: unknown;
  output?: unknown;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  retries?: number | null;
  error?: string | null;
  attention?: boolean;
}

/** The independent judge's call, as `POST /api/v1/debrief-quality/judge` returns it. */
export interface JudgeCallLog {
  input: string;
  prompt_inlined?: boolean;
  output?: unknown;
  model?: string | null;
  fell_back_from?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  ms?: number | null;
  error?: string | null;
}

/**
 * Which Skills Store version each prompt code ran at, for a run: a number,
 * or the text itself when the run replaced it (a challenger in a replay), so
 * the message is still exactly what was sent.
 */
export type PromptVersions = Record<string, number | { text: string } | null>;

export interface AgentLogEntryView {
  seq: number;
  kind: DebriefRunLogKind;
  step: string;
  round: number | null;
  startedAt: string | null;
  model: string | null;
  fallbackModel: string | null;
  prompt: {
    code: string;
    version: number | null;
    /** Where the admin opens this version in the Skills Store. */
    href: string;
    /** The message carries `{{system_prompt}}` in its place (Show expands it). */
    inlined: boolean;
  } | null;
  input: unknown;
  output: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  ms: number | null;
  retries: number;
  error: string | null;
  attention: boolean;
}

export interface AgentLogsView {
  runId: string;
  /** The day full agent logs began to be kept; runs before it have none. */
  loggedFrom: string | null;
  run: {
    sessionId: string;
    scenarioTitle: string | null;
    status: string;
    recipeKey: string | null;
    releaseVersion: number | null;
    language: string | null;
    costUsd: number | null;
    seconds: number | null;
  };
  entries: AgentLogEntryView[];
  /** Each prompt version the entries name, once: `code@version` → text. */
  prompts: Record<string, string>;
}

/** The admin's Skills Store page for one prompt version. */
export const promptHref = (code: string, version: number | null): string =>
  `/manage-prompts?${new URLSearchParams({
    prompt: code,
    ...(version != null ? { version: String(version) } : {}),
  })}`;

const num = (v: unknown): number | null =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * The Agent logs of a Debrief run (`debrief_run_logs`, migration
 * 1981901000000): what every agent was sent and answered, written once when
 * the graph's answer is applied (and when the independent judge scores the
 * run), read by the Ally team on the console. Append-only; the rows go with
 * the run, and the run with its session.
 */
@Injectable()
export class DebriefRunLogsService {
  private readonly logger = LoggerService.getInstance(
    DebriefRunLogsService.name,
  );

  constructor(
    @InjectRepository(DebriefRunLog)
    private readonly logs: Repository<DebriefRunLog>,
  ) {}

  /**
   * Store the graph's entries. A resumed run answers with every entry again
   * (the earlier ones from its checkpoint, with the same `seq`), so an entry
   * already stored is left as it is. Never fails the run: a write error is
   * logged and the debrief goes on.
   */
  async record(
    run: Pick<DebriefRun, 'id' | 'tenantId'>,
    entries: GraphLogEntry[] | undefined,
    versions: PromptVersions = {},
  ): Promise<number> {
    if (!entries?.length) return 0;
    try {
      const rows = entries.map((e) => this.row(run, e, versions));
      const res = await this.logs
        .createQueryBuilder()
        .insert()
        .into(DebriefRunLog)
        .values(rows)
        .orIgnore()
        .execute();
      return (res.identifiers ?? []).filter(Boolean).length;
    } catch (e) {
      this.logger.warn(
        `[debrief] could not store the agent logs of run ${run.id}: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /** The independent judge's call, after the run's own entries. */
  async recordJudge(
    run: Pick<DebriefRun, 'id' | 'tenantId'>,
    log: JudgeCallLog | null | undefined,
    prompt: { code: string; version: number | null },
    judgeModel: string | null,
  ): Promise<void> {
    if (!log) return;
    try {
      const last = await this.logs
        .createQueryBuilder('l')
        .select('MAX(l.seq)', 'max')
        .where('l.run_id = :id', { id: run.id })
        .getRawOne<{ max: number | null }>();
      const ran = log.model ?? judgeModel;
      const priced =
        ran && (log.tokens_in || log.tokens_out)
          ? computeCostUsd(ran, log.tokens_in ?? 0, log.tokens_out ?? 0)
          : null;
      await this.logs.insert({
        tenantId: run.tenantId ?? null,
        runId: run.id,
        seq: Number(last?.max ?? 0) + 1,
        step: 'judge',
        round: null,
        kind: DebriefRunLogKind.MODEL,
        model: ran,
        fallbackModel: log.fell_back_from ? ran : null,
        promptCode: log.prompt_inlined ? prompt.code : null,
        promptVersion: log.prompt_inlined ? prompt.version : null,
        input: log.input as any,
        output: (log.output ?? null) as any,
        tokensIn: log.tokens_in ?? null,
        tokensOut: log.tokens_out ?? null,
        costUsd: priced?.priced ? priced.costUsd.toFixed(6) : null,
        ms: log.ms ?? null,
        retries: 0,
        error: log.error ?? null,
        attention: !!log.error,
        startedAt: new Date(Date.now() - Number(log.ms ?? 0)),
      });
    } catch (e) {
      this.logger.warn(
        `[debrief] could not store the judge's log for run ${run.id}: ${(e as Error).message}`,
      );
    }
  }

  private row(
    run: Pick<DebriefRun, 'id' | 'tenantId'>,
    e: GraphLogEntry,
    versions: PromptVersions,
  ): Partial<DebriefRunLog> {
    const ran = e.promptCode ? versions[e.promptCode] : undefined;
    let input = e.input ?? null;
    let promptCode = e.promptCode ?? null;
    let promptVersion: number | null = null;
    if (promptCode && typeof ran === 'number') {
      promptVersion = ran;
    } else if (promptCode && ran && typeof ran === 'object') {
      // Replaced for this run only: there is no version to point at, so the
      // message keeps the text it was sent with.
      if (e.promptInlined && typeof input === 'string') {
        input = input.replace(SYSTEM_PROMPT_MARKER, ran.text);
      }
      promptCode = null;
    }
    return {
      tenantId: run.tenantId ?? null,
      runId: run.id,
      seq: e.seq,
      step: String(e.step).slice(0, 60),
      round: e.round ?? null,
      kind:
        e.kind === 'model' ? DebriefRunLogKind.MODEL : DebriefRunLogKind.CODE,
      model: e.model ?? null,
      fallbackModel: e.fallbackModel ?? null,
      promptCode,
      promptVersion,
      input: input as any,
      output: (e.output ?? null) as any,
      tokensIn: e.tokensIn ?? null,
      tokensOut: e.tokensOut ?? null,
      costUsd: e.costUsd != null ? Number(e.costUsd).toFixed(6) : null,
      ms: e.ms ?? null,
      retries: e.retries ?? 0,
      error: e.error ?? null,
      attention: !!e.attention || !!e.error,
      startedAt: e.startedAt ? new Date(e.startedAt) : null,
    };
  }

  /** The day the first entry was stored: runs before it have none. */
  async loggedFrom(): Promise<string | null> {
    const r = await this.logs
      .createQueryBuilder('l')
      .select('MIN(l.created_at)', 'first')
      .getRawOne<{ first: Date | string | null }>();
    return r?.first ? new Date(r.first).toISOString().slice(0, 10) : null;
  }

  /** The console's Agent logs page for one run (Ally team only). */
  async view(runId: string): Promise<AgentLogsView> {
    const [run] = (await this.logs.query(
      `SELECT r.id, r."scenarioSessionId" AS "sessionId", r.status, r."recipeKey",
              r."releaseVersion", r.language,
              COALESCE(r."actualCostUsd", r."estimatedCostUsd")::float AS "costUsd",
              extract(epoch FROM r."finishedAt" - r."startedAt")::int AS seconds,
              sc.title AS "scenarioTitle"
         FROM debrief_runs r
         LEFT JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
         LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
        WHERE r.id = $1`,
      [runId],
    )) as Array<Record<string, any>>;
    if (!run) throw new NotFoundException('No such debrief run');
    const rows = await this.logs.find({
      where: { runId },
      order: { seq: 'ASC' },
    });
    const prompts = await this.promptTexts(rows);
    return {
      runId,
      loggedFrom: await this.loggedFrom(),
      run: {
        sessionId: run.sessionId,
        scenarioTitle: run.scenarioTitle ?? null,
        status: run.status,
        recipeKey: run.recipeKey ?? null,
        releaseVersion: run.releaseVersion ?? null,
        language: run.language ?? null,
        costUsd: num(run.costUsd),
        seconds: num(run.seconds),
      },
      entries: rows.map((r) => ({
        seq: r.seq,
        kind: r.kind,
        step: r.step,
        round: r.round ?? null,
        startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        model: r.model ?? null,
        fallbackModel: r.fallbackModel ?? null,
        prompt: r.promptCode
          ? {
              code: r.promptCode,
              version: r.promptVersion ?? null,
              href: promptHref(r.promptCode, r.promptVersion ?? null),
              inlined:
                typeof r.input === 'string' &&
                r.input.includes(SYSTEM_PROMPT_MARKER),
            }
          : null,
        input: r.input ?? null,
        output: r.output ?? null,
        tokensIn: r.tokensIn ?? null,
        tokensOut: r.tokensOut ?? null,
        costUsd: num(r.costUsd),
        ms: r.ms ?? null,
        retries: r.retries ?? 0,
        error: r.error ?? null,
        attention: !!r.attention,
      })),
      prompts,
    };
  }

  /** The text of every prompt version the entries name, once each. */
  private async promptTexts(
    rows: DebriefRunLog[],
  ): Promise<Record<string, string>> {
    const wanted = [
      ...new Set(
        rows
          .filter((r) => r.promptCode && r.promptVersion != null)
          .map((r) => `${r.promptCode}@${r.promptVersion}`),
      ),
    ];
    if (!wanted.length) return {};
    const pairs = wanted.map((k) => k.split('@'));
    const found = (await this.logs.query(
      `SELECT p."promptCode" AS code, pv.version, pv.prompt
         FROM prompts p
         JOIN prompts_versions pv ON pv."promptId" = p.id
        WHERE (p."promptCode", pv.version) IN (
          SELECT * FROM unnest($1::text[], $2::int[]))`,
      [pairs.map((p) => p[0]), pairs.map((p) => Number(p[1]))],
    )) as Array<{ code: string; version: number; prompt: string }>;
    return Object.fromEntries(
      found.map((f) => [`${f.code}@${f.version}`, f.prompt]),
    );
  }
}
