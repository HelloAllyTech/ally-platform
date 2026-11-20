import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createAgent, HumanMessage, toolStrategy } from 'langchain';
import { In, LessThan, QueryFailedError, Repository } from 'typeorm';
import { z } from 'zod';
import {
  AUDIT_AGENT_LIMITS,
  AUDIT_AGENT_SYSTEM_PROMPT,
} from '../constants/analytics-agent.constants';
import {
  AnalyticsAuditDetailDto,
  AnalyticsAuditSummaryDto,
} from '../dto/analytics-audit.dto';
import {
  AnalyticsAgentAudit,
  AnalyticsAuditedMessage,
  AnalyticsAuditStatus,
  AnalyticsAuditTrigger,
} from '../entity/analytics-agent-audit.entity';
import {
  AnalyticsAgentFeedback,
  AnalyticsAgentMessage,
} from '../entity/analytics-agent-message.entity';
import {
  AVAILABLE_TABLES,
  getLlm,
  getMcpClient,
} from './new-analytical-agent.service';

const auditSchema = z.object({
  verdict: z.enum(['correct', 'minor_issues', 'incorrect', 'unverifiable']),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['high', 'medium', 'low']),
      description: z.string(),
    }),
  ),
});

type AgentTools = Awaited<
  ReturnType<ReturnType<typeof getMcpClient>['listTools']>
>;
type AuditAgent = ReturnType<typeof createAgent>;

/**
 * The shared MCP client's servers the auditor connects to. Datalyze — the
 * analytics agent's own method server — is left out on purpose: the auditor
 * checks results against the data, the dbt docs and the product source, and
 * never connects to it.
 */
const AUDIT_MCP_SERVERS = ['bigQuery', 'github'] as const;

/**
 * A tool the auditor must never hold even though its server exposes it.
 * `execute_sql` can write to BigQuery (the prompt forbids it, but a prompt is
 * not a control); `execute_sql_readonly` is the one it gets.
 *
 * Compared by the server's own name for the tool: the MCP client prefixes every
 * tool with its server (`bigQuery_execute_sql`), so the name it hands back is
 * never the bare one.
 */
const BLOCKED_TOOL_NAMES: ReadonlySet<string> = new Set(['execute_sql']);

/** A tool's name as its server calls it: the client's `<server>_` prefix removed. */
function bareToolName(name: string): string {
  for (const server of AUDIT_MCP_SERVERS) {
    if (name.startsWith(`${server}_`)) return name.slice(server.length + 1);
  }
  return name;
}

export const AUDIT_ALREADY_RUNNING_MESSAGE =
  'An audit is already running. Wait for it to finish before starting another.';

export function selectAuditTools(tools: AgentTools): AgentTools {
  return tools.filter(
    (tool) => !BLOCKED_TOOL_NAMES.has(bareToolName(tool.name)),
  );
}

/** A caller-supplied count, forced into 1..MAX; anything unusable becomes the default. */
export function resolveMessageCount(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return AUDIT_AGENT_LIMITS.DEFAULT_MESSAGE_COUNT;
  }
  return Math.min(
    Math.max(1, Math.floor(requested)),
    AUDIT_AGENT_LIMITS.MAX_MESSAGE_COUNT,
  );
}

/** What the auditor is told of the asker's rating. Fixed text: never anything they typed. */
function describeFeedback(feedback: AnalyticsAgentFeedback): string {
  return feedback === 'down'
    ? 'The person who asked gave this answer a thumbs down. They did not say why.'
    : 'The person who asked gave this answer a thumbs up.';
}

/**
 * What the auditor is shown for one message. The text fields are quoted data,
 * not instructions. The feedback block is left out entirely when the asker gave
 * none, so there is nothing for the auditor to read into its absence.
 */
function buildAuditInput(entry: {
  askedAt: string;
  question: string;
  answer: string;
  sql: string;
  feedback?: AnalyticsAgentFeedback | null;
}): HumanMessage {
  return new HumanMessage(
    [
      `Audit the following answer. It was asked at ${entry.askedAt}; the data may have changed since.`,
      '',
      '<question>',
      entry.question,
      '</question>',
      '',
      '<answer>',
      entry.answer,
      '</answer>',
      '',
      '<sql_the_agent_ran>',
      entry.sql || '(none recorded)',
      '</sql_the_agent_ran>',
      ...(entry.feedback
        ? [
            '',
            '<user_feedback>',
            describeFeedback(entry.feedback),
            '</user_feedback>',
          ]
        : []),
    ].join('\n'),
  );
}

/** Runs `worker` over `items` with at most `limit` in flight. Rejects on the first failure. */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        await worker(items[next++]);
      }
    },
  );
  await Promise.all(lanes);
}

/** Postgres unique_violation — here, the one-running-audit-at-a-time index. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

export function toSummary(
  run: Pick<
    AnalyticsAgentAudit,
    'id' | 'ranAt' | 'status' | 'trigger' | 'totalMessages' | 'messages'
  >,
): AnalyticsAuditSummaryDto {
  const verdictCounts: Record<string, number> = {};
  for (const entry of run.messages) {
    const key = entry.audit?.verdict ?? 'error';
    verdictCounts[key] = (verdictCounts[key] ?? 0) + 1;
  }
  return {
    id: run.id,
    ranAt: run.ranAt.toISOString(),
    status: run.status,
    trigger: run.trigger,
    totalMessages: run.totalMessages,
    completedMessages: run.messages.length,
    verdictCounts,
  };
}

/** A run that has been started: its saved row, and a promise for when it ends. */
export interface StartedAudit {
  audit: AnalyticsAgentAudit;
  /** Resolves when every message is done. Never rejects: a failure marks the run `failed`. */
  done: Promise<void>;
}

/**
 * The Analytics Agent's auditor.
 *
 * Takes the last N answered messages (a message is one question + its answer)
 * that no earlier run has audited, has a LangChain agent check each answer
 * against BigQuery, the dbt repository and the product source, and saves the
 * run as one `analytics_agent_audits` row.
 *
 * A run takes minutes — every message is its own agent run, with several
 * BigQuery and GitHub calls in it — so {@link startAudit} returns as soon as the
 * run is registered and the work carries on in the background. The row is
 * created `running` and each message's entry is appended as it finishes, which
 * is what lets the UI show progress. Only one run may be `running` at a time.
 *
 * Reads `analytics_agent_messages` across every user — it is a platform-scope
 * quality check on the agent, not a view of anyone's conversations — so it is
 * meant to be run by the system or a super-admin, never exposed per user.
 */
@Injectable()
export class AnalyticsAuditAgentService {
  private readonly logger = new Logger(AnalyticsAuditAgentService.name);

  constructor(
    @InjectRepository(AnalyticsAgentMessage)
    private readonly messages: Repository<AnalyticsAgentMessage>,
    @InjectRepository(AnalyticsAgentAudit)
    private readonly audits: Repository<AnalyticsAgentAudit>,
  ) {}

  /**
   * Registers a run over the last `count` answered messages (default 15) that no
   * earlier run has audited, and starts auditing them in the background. A
   * message is audited once: it is skipped if any saved run holds a finished
   * audit of it. (An entry whose audit failed has no verdict, so it does not
   * count and is retried.)
   *
   * Returns null when there was nothing new to audit. Throws a 409 when a run is
   * already in progress.
   */
  async startAudit(count?: number): Promise<StartedAudit | null> {
    const limit = resolveMessageCount(count);

    await this.assertNoRunningAudit();

    const newest = await this.messages.find({
      where: { outcome: 'answer' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (newest.length === 0) {
      this.logger.log('Analytics agent audit skipped: no answered messages');
      return null;
    }

    // Oldest-first so the audit reads in the order the questions were asked.
    const audited = await this.findAuditedMessageIds(newest.map((m) => m.id));
    const rows = newest.filter((m) => !audited.has(m.id)).reverse();
    if (rows.length === 0) {
      this.logger.log(
        `Analytics agent audit skipped: the last ${newest.length} message(s) were all audited already`,
      );
      return null;
    }

    return this.launch(rows, 'manual');
  }

  /**
   * The scheduled run: audits every answered message no earlier run has covered,
   * newest first, up to `SCHEDULED_MAX_MESSAGES`. A fixed last-N would skip any
   * week busier than N; this takes whatever is new. Same guards as
   * {@link startAudit}: a 409 when a run is in progress, null when nothing is new.
   */
  async startScheduledAudit(): Promise<StartedAudit | null> {
    await this.assertNoRunningAudit();

    const unaudited: { id: string }[] = await this.messages.query(
      `WITH audited AS (
         SELECT DISTINCT entry->>'messageId' AS "messageId"
           FROM "analytics_agent_audits" a,
                jsonb_array_elements(a."messages") AS entry
          WHERE jsonb_typeof(entry->'audit') = 'object'
       )
       SELECT m."id"
         FROM "analytics_agent_messages" m
        WHERE m."outcome" = 'answer'
          AND NOT EXISTS (
                SELECT 1 FROM audited WHERE audited."messageId" = m."id"::text
              )
        ORDER BY m."createdAt" DESC
        LIMIT $1`,
      [AUDIT_AGENT_LIMITS.SCHEDULED_MAX_MESSAGES],
    );
    if (unaudited.length === 0) {
      this.logger.log(
        'Scheduled analytics agent audit skipped: nothing new to audit',
      );
      return null;
    }

    const rows = await this.messages.find({
      where: { id: In(unaudited.map((row) => row.id)) },
      order: { createdAt: 'ASC' },
    });
    return this.launch(rows, 'scheduled');
  }

  /** {@link startAudit}, then waits for the run to end. For a scheduler. */
  async runAudit(count?: number): Promise<AnalyticsAgentAudit | null> {
    const started = await this.startAudit(count);
    if (!started) return null;
    await started.done;
    return this.audits.findOneByOrFail({ id: started.audit.id });
  }

  /** Recent runs, newest first, as summaries. Messages are not included. */
  async listRuns(): Promise<AnalyticsAuditSummaryDto[]> {
    const rows: {
      id: string;
      ranAt: Date;
      status: AnalyticsAuditStatus;
      trigger: AnalyticsAuditTrigger;
      totalMessages: number;
      completedMessages: number;
      verdictCounts: Record<string, number>;
    }[] = await this.audits.query(
      `SELECT a."id", a."ranAt", a."status", a."trigger", a."totalMessages",
              jsonb_array_length(a."messages") AS "completedMessages",
              COALESCE((
                SELECT jsonb_object_agg(t.verdict, t.n)
                  FROM (
                    SELECT COALESCE(e->'audit'->>'verdict', 'error') AS verdict,
                           COUNT(*)::int AS n
                      FROM jsonb_array_elements(a."messages") AS e
                     GROUP BY 1
                  ) t
              ), '{}'::jsonb) AS "verdictCounts"
         FROM "analytics_agent_audits" a
        ORDER BY a."ranAt" DESC
        LIMIT $1`,
      [AUDIT_AGENT_LIMITS.HISTORY_LIMIT],
    );
    return rows.map((row) => ({
      id: row.id,
      ranAt: new Date(row.ranAt).toISOString(),
      status: row.status,
      trigger: row.trigger,
      totalMessages: row.totalMessages,
      completedMessages: row.completedMessages,
      verdictCounts: row.verdictCounts,
    }));
  }

  /** One run with every audited message so far, oldest question first. */
  async getRun(id: string): Promise<AnalyticsAuditDetailDto> {
    const run = await this.audits.findOne({ where: { id } });
    if (!run) throw new NotFoundException('Audit not found');
    return {
      ...toSummary(run),
      // Entries are appended as they finish, so put them back in asked order.
      messages: [...run.messages].sort((a, b) =>
        a.askedAt.localeCompare(b.askedAt),
      ),
    };
  }

  /** Frees a dead run's slot, then refuses to go on while a live one holds it. */
  private async assertNoRunningAudit(): Promise<void> {
    await this.failStaleRuns();
    // Cheap early exit; the unique index on insert is what actually enforces it.
    if (await this.audits.exists({ where: { status: 'running' } })) {
      throw new ConflictException(AUDIT_ALREADY_RUNNING_MESSAGE);
    }
  }

  /** Registers the run for `rows` and starts auditing them in the background. */
  private async launch(
    rows: AnalyticsAgentMessage[],
    trigger: AnalyticsAuditTrigger,
  ): Promise<StartedAudit> {
    // Built before the row exists, so a tool connection failure surfaces to the
    // caller and leaves no `running` row behind to block the next attempt.
    const agent = await this.buildAgent();
    const audit = await this.createRunningRow(rows.length, trigger);
    return { audit, done: this.processRun(audit.id, agent, rows) };
  }

  private async buildAgent(): Promise<AuditAgent> {
    const tools = selectAuditTools(
      await getMcpClient().listTools(...AUDIT_MCP_SERVERS),
    );
    return createAgent({
      model: getLlm(),
      systemPrompt: AUDIT_AGENT_SYSTEM_PROMPT.replace(
        '{{AVAILABLE_TABLES}}',
        Object.keys(AVAILABLE_TABLES).join('\n'),
      ),
      responseFormat: toolStrategy(auditSchema),
      tools,
    });
  }

  /**
   * A run still `running` long after it could have finished belongs to a process
   * that went away. Marking it failed frees the one-running slot.
   */
  private async failStaleRuns(): Promise<void> {
    await this.audits.update(
      {
        status: 'running',
        ranAt: LessThan(new Date(Date.now() - AUDIT_AGENT_LIMITS.STALE_RUN_MS)),
      },
      { status: 'failed' },
    );
  }

  private async createRunningRow(
    totalMessages: number,
    trigger: AnalyticsAuditTrigger,
  ): Promise<AnalyticsAgentAudit> {
    try {
      return await this.audits.save(
        this.audits.create({
          ranAt: new Date(),
          status: 'running',
          trigger,
          totalMessages,
          messages: [],
        }),
      );
    } catch (err) {
      // Lost the race with another start between the early check and here.
      if (isUniqueViolation(err)) {
        throw new ConflictException(AUDIT_ALREADY_RUNNING_MESSAGE);
      }
      throw err;
    }
  }

  /**
   * Audits `rows`, appending each entry as it finishes, then closes the run.
   * Never rejects — it runs detached from any request.
   */
  private async processRun(
    auditId: string,
    agent: AuditAgent,
    rows: AnalyticsAgentMessage[],
  ): Promise<void> {
    let failedMessages = 0;
    try {
      await runWithConcurrency(
        rows,
        AUDIT_AGENT_LIMITS.CONCURRENCY,
        async (row) => {
          const entry = await this.auditMessage(agent, row);
          if (entry.audit === null) failedMessages += 1;
          await this.appendEntry(auditId, entry);
        },
      );
      await this.setStatus(auditId, 'completed');
      this.logger.log(
        `Analytics agent audit ${auditId} completed: ${rows.length} message(s), ${failedMessages} failed`,
      );
    } catch (err) {
      this.logger.error(
        `Analytics agent audit ${auditId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.setStatus(auditId, 'failed').catch(() => undefined);
    }
  }

  /** Atomic append, so entries finishing together cannot overwrite each other. */
  private async appendEntry(
    auditId: string,
    entry: AnalyticsAuditedMessage,
  ): Promise<void> {
    await this.audits.query(
      `UPDATE "analytics_agent_audits"
          SET "messages" = "messages" || $1::jsonb, "updatedAt" = now()
        WHERE "id" = $2`,
      [JSON.stringify([entry]), auditId],
    );
  }

  /** Only moves a run that is still `running`, so a later state is never overwritten. */
  private async setStatus(
    auditId: string,
    status: AnalyticsAuditStatus,
  ): Promise<void> {
    await this.audits.update({ id: auditId, status: 'running' }, { status });
  }

  /**
   * Which of `messageIds` a saved run has already audited. Only entries with a
   * real audit count: a failed one (`audit` null) has no verdict, so the message
   * is still owed one.
   */
  private async findAuditedMessageIds(
    messageIds: string[],
  ): Promise<Set<string>> {
    const found: { messageId: string }[] = await this.audits.query(
      `SELECT DISTINCT entry->>'messageId' AS "messageId"
         FROM "analytics_agent_audits" a,
              jsonb_array_elements(a."messages") AS entry
        WHERE entry->>'messageId' = ANY($1::text[])
          AND jsonb_typeof(entry->'audit') = 'object'`,
      [messageIds],
    );
    return new Set(found.map((row) => row.messageId));
  }

  private async auditMessage(
    agent: AuditAgent,
    row: AnalyticsAgentMessage,
  ): Promise<AnalyticsAuditedMessage> {
    const response = row.response as { answer?: unknown; sql?: unknown };
    const answer = typeof response.answer === 'string' ? response.answer : '';
    const sql = typeof response.sql === 'string' ? response.sql : '';
    const entry: AnalyticsAuditedMessage = {
      messageId: row.id,
      askedAt: row.createdAt.toISOString(),
      question: row.question,
      answer,
      audit: null,
    };

    try {
      const result = await agent.invoke(
        {
          messages: [
            buildAuditInput({ ...entry, sql, feedback: row.feedback }),
          ],
        },
        { recursionLimit: AUDIT_AGENT_LIMITS.RECURSION_LIMIT },
      );
      const parsed = auditSchema.safeParse(result.structuredResponse);
      if (!parsed.success) {
        throw new Error('The audit agent finished without a valid verdict');
      }
      return { ...entry, audit: parsed.data };
    } catch (err) {
      // Ids only: a question can carry anything an admin typed.
      this.logger.error(
        `Audit of analytics agent message ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ...entry,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
