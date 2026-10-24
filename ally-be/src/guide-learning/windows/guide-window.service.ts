import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentTraceService } from 'src/llm-agent/harness/trace/agent-trace.service';
import { ALLY_GUIDE_AGENT_KEY } from 'src/guide/release/guide-release.bundle';
import {
  DEFAULT_CRISIS_CHECK_IN_TEXT,
  DEFAULT_CRISIS_STAY_TEXT,
  DEFAULT_CRISIS_TEXT,
} from 'src/guide/safety/fixed-responses';
import { QuizContent } from 'src/track/type/quiz.type';
import {
  QuizKey,
  failedChecks,
  runDeterministicChecks,
} from '../checks/deterministic-checks';
import { quizKeysFromContent } from '../checks/quiz-keys';
import { readSituation } from '../checks/situation';
import { MAX_CANDIDATES_PER_NIGHT } from '../constants/guide-learning.constants';
import {
  MessageRow,
  ProductionWindow,
  TurnRow,
  WindowContext,
  assembleWindow,
  summaryFlags,
} from './production-window';

const TURN_COLUMNS = `t."id", t."threadId", t."releaseId", t."arm", t."channel", t."status",
  t."trigger", t."tenant_id" AS "tenantId", th."trackId", th."userId", tr."summary"`;

/**
 * Reads production windows for the learning loop: a night's candidates for
 * the evaluator, one turn for a review or "Save as eval case". Content stays
 * in memory; nothing here writes.
 */
@Injectable()
export class GuideWindowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly traces: AgentTraceService,
  ) {}

  /** Every approved crisis text, plus the code's own fixed lines. */
  async approvedCrisisTexts(): Promise<string[]> {
    const rows: Array<{ body: string }> = await this.dataSource.query(
      `SELECT "body" FROM "guide_crisis_responses" WHERE "active" = true`,
    );
    return [
      ...rows.map((row) => row.body.trim()),
      DEFAULT_CRISIS_TEXT,
      DEFAULT_CRISIS_STAY_TEXT,
      DEFAULT_CRISIS_CHECK_IN_TEXT,
    ];
  }

  /**
   * A track's quiz answer material the learner has not earned. Keyed by
   * (track, user) because submitting a quiz can earn its explanations.
   */
  async quizKeys(
    trackId: string | null,
    userId: number | null,
  ): Promise<QuizKey[]> {
    if (!trackId) return [];
    const rows: Array<{ content: QuizContent | null; submitted: boolean }> =
      await this.dataSource.query(
        `SELECT ti."content",
                COALESCE(bool_or(tip."attemptCount" > 0 OR tip."status" = 'COMPLETED'), false) AS "submitted"
           FROM "track_items" ti
           LEFT JOIN "track_item_progress" tip
             ON tip."trackItemId" = ti."id" AND tip."userId" = $2
          WHERE ti."trackId" = $1 AND ti."type" = 'QUIZ'
          GROUP BY ti."id", ti."content"`,
        [trackId, userId ?? -1],
      );
    return rows.flatMap((row) =>
      quizKeysFromContent(row.content, { submitted: Boolean(row.submitted) }),
    );
  }

  /**
   * A night's candidate windows (UTC day `night`), each with the checks that
   * need no trace payload already run, and its flags.
   */
  async loadNight(
    night: string,
    praiseEveryTurns: number,
  ): Promise<ProductionWindow[]> {
    const turns: TurnRow[] = await this.dataSource.query(
      `SELECT ${TURN_COLUMNS}
         FROM "agent_turns" t
         JOIN "guide_threads" th ON th."id" = t."threadId"
         LEFT JOIN "agent_turn_traces" tr ON tr."turnId" = t."id"
        WHERE t."agentKey" = $1
          AND t."createdAt" >= $2::date AND t."createdAt" < $2::date + interval '1 day'
          AND t."status" IN ('completed', 'failed', 'interrupted')
        ORDER BY t."createdAt"
        LIMIT $3`,
      [ALLY_GUIDE_AGENT_KEY, night, MAX_CANDIDATES_PER_NIGHT],
    );
    if (!turns.length) return [];
    const threadIds = [...new Set(turns.map((t) => t.threadId))];
    const messages: MessageRow[] = await this.dataSource.query(
      `SELECT m."id", m."threadId", m."seq", m."role", m."kind", m."content",
              m."redactedContent", m."flags", m."turnId"
         FROM "guide_messages" m
        WHERE m."threadId" = ANY($1::uuid[])
          AND m."role" IN ('learner', 'ally')
          AND m."createdAt" >= $2::date - interval '1 day'
          AND m."createdAt" < $2::date + interval '1 day'`,
      [threadIds, night],
    );
    const thumbsDown: Array<{ turnId: string }> = await this.dataSource.query(
      `SELECT DISTINCT m."turnId"
         FROM "guide_turn_feedback" f
         JOIN "guide_messages" m ON m."id" = f."messageId"
        WHERE f."rating" < 0 AND m."turnId" = ANY($1::uuid[])`,
      [turns.map((t) => t.id)],
    );
    const downTurns = new Set(thumbsDown.map((row) => row.turnId));
    const crisisTexts = await this.approvedCrisisTexts();
    const byThread = groupBy(messages, (m) => m.threadId);
    const keyCache = new Map<string, Promise<QuizKey[]>>();
    const keysFor = (turn: TurnRow) => {
      const cacheKey = `${turn.trackId}:${turn.userId}`;
      if (!keyCache.has(cacheKey)) {
        keyCache.set(cacheKey, this.quizKeys(turn.trackId, turn.userId));
      }
      return keyCache.get(cacheKey)!;
    };

    const out: ProductionWindow[] = [];
    for (const turn of turns) {
      const ctx: WindowContext = {
        quizKeys: await keysFor(turn),
        approvedCrisisTexts: crisisTexts,
        praiseEveryTurns,
      };
      const assembled = assembleWindow(
        turn,
        byThread.get(turn.threadId) ?? [],
        ctx,
      );
      if (!assembled) continue;
      const { flags, safety } = summaryFlags(turn, downTurns.has(turn.id));
      const failed = failedChecks(runDeterministicChecks(assembled.window));
      for (const check of failed) flags.push(`check_${check.id}`);
      out.push({
        ...assembled,
        flags,
        safety: safety || failed.some((check) => check.severity === 'safety'),
      });
    }
    return out;
  }

  /**
   * Fill in what only the trace payload holds — the situation report (budget,
   * release window, quiz open) and the tool calls with their inputs — so the
   * full set of checks can run. A window with no payload keeps what it had.
   */
  async enrich(window: ProductionWindow): Promise<ProductionWindow> {
    const payload = await this.traces.getPayload(window.turn.id);
    if (!payload) return window;
    const situation = readSituation(payload.situationReport as string);
    const toolCalls = Array.isArray(payload.toolCalls)
      ? (payload.toolCalls as Array<Record<string, any>>).map((call) => ({
          name: String(call.name),
          input: (call.input as Record<string, unknown>) ?? null,
        }))
      : window.window.toolCalls;
    return {
      ...window,
      situation,
      window: {
        ...window.window,
        channel: situation.channel ?? window.window.channel,
        budget: situation.budget,
        releaseWindowOpen: situation.releaseWindowOpen,
        toolCalls,
      },
    };
  }

  /** One turn's window, with everything the payload adds. */
  async loadTurn(
    turnId: string,
    praiseEveryTurns: number,
  ): Promise<ProductionWindow | null> {
    const [turn]: TurnRow[] = await this.dataSource.query(
      `SELECT ${TURN_COLUMNS}
         FROM "agent_turns" t
         JOIN "guide_threads" th ON th."id" = t."threadId"
         LEFT JOIN "agent_turn_traces" tr ON tr."turnId" = t."id"
        WHERE t."id" = $1 AND t."agentKey" = $2`,
      [turnId, ALLY_GUIDE_AGENT_KEY],
    );
    if (!turn) return null;
    const messages: MessageRow[] = await this.dataSource.query(
      `WITH anchor AS (
         SELECT max("seq") AS seq FROM "guide_messages" WHERE "turnId" = $2
       )
       SELECT m."id", m."threadId", m."seq", m."role", m."kind", m."content",
              m."redactedContent", m."flags", m."turnId"
         FROM "guide_messages" m, anchor
        WHERE m."threadId" = $1 AND m."role" IN ('learner', 'ally')
          AND m."seq" <= anchor.seq AND m."seq" > anchor.seq - 20`,
      [turn.threadId, turn.id],
    );
    const [down]: Array<{ n: string }> = await this.dataSource.query(
      `SELECT count(*) AS n FROM "guide_turn_feedback" f
         JOIN "guide_messages" m ON m."id" = f."messageId"
        WHERE f."rating" < 0 AND m."turnId" = $1`,
      [turn.id],
    );
    const assembled = assembleWindow(turn, messages, {
      quizKeys: await this.quizKeys(turn.trackId, turn.userId),
      approvedCrisisTexts: await this.approvedCrisisTexts(),
      praiseEveryTurns,
    });
    if (!assembled) return null;
    const { flags, safety } = summaryFlags(turn, Number(down?.n) > 0);
    return this.enrich({ ...assembled, flags, safety });
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
