import { createHash } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DEBRIEF_PLATFORMS,
  DebriefLearnerEventKind,
  DebriefPlatform,
  DebriefPulseQuestion,
} from '../entity/debrief-learner-event.entity';

/** PRD §9: the pulse asks on 1 in 10 debriefs… */
export const PULSE_SHARE = 0.1;
/** …for the first 8 weeks after an organisation's first live debrief. */
export const PULSE_WEEKS = 8;

/** A stable draw per debrief, so the same debrief always asks (or never does). */
export function pulseSampled(runId: string, share = PULSE_SHARE): boolean {
  const h = createHash('sha256').update(`pulse:${runId}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000 < share;
}

export interface DebriefPulseAnswers {
  knew_next: boolean | null;
  fair: boolean | null;
}
import { LoggerService } from '../../logger/logger.service';

/**
 * Records what a learner did with a debrief (v9 FR-48, §3.3), once per
 * session, learner and kind. Recording never breaks what the learner was
 * doing: a failure is logged and swallowed.
 */
@Injectable()
export class DebriefLearnerEventsService {
  private readonly logger = LoggerService.getInstance(
    DebriefLearnerEventsService.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  /** A platform the apps may send; anything else is dropped, never refused. */
  static platform(value: unknown): DebriefPlatform | null {
    return (DEBRIEF_PLATFORMS as readonly string[]).includes(String(value))
      ? (value as DebriefPlatform)
      : null;
  }

  /**
   * Refuses anyone but the learner who did the session. The session's live
   * run is attached when there is one: "waited" and "left before ready" can
   * arrive before the run exists.
   */
  async recordForLearner(
    sessionId: string,
    userId: number,
    kind: DebriefLearnerEventKind,
    platform: DebriefPlatform | null,
  ): Promise<{ ok: true }> {
    const [s] = await this.dataSource.query(
      `SELECT "counselorId" AS counselor_id, tenant_id FROM scenario_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!s || Number(s.counselor_id) !== Number(userId)) {
      throw new ForbiddenException('Not your session');
    }
    const [run] = await this.dataSource.query(
      `SELECT id FROM debrief_runs WHERE "scenarioSessionId" = $1 AND mode = 'live'`,
      [sessionId],
    );
    await this.record({
      sessionId,
      userId,
      kind,
      platform,
      tenantId: s.tenant_id ?? null,
      runId: run?.id ?? null,
    });
    return { ok: true };
  }

  /** For callers that already checked the learner owns the run. */
  async record(e: {
    sessionId: string;
    userId: number;
    kind: DebriefLearnerEventKind;
    platform?: DebriefPlatform | null;
    tenantId?: string | null;
    runId?: string | null;
  }): Promise<void> {
    try {
      // A later event of the same kind fills in a run that was missing
      // (left before ready, then the run appeared), never anything else.
      await this.dataSource.query(
        `INSERT INTO debrief_learner_events
           (tenant_id, "runId", "scenarioSessionId", "userId", kind, platform)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("scenarioSessionId", "userId", kind)
         DO UPDATE SET "runId" = COALESCE(debrief_learner_events."runId", EXCLUDED."runId"),
                       platform = COALESCE(debrief_learner_events.platform, EXCLUDED.platform)`,
        [
          e.tenantId ?? null,
          e.runId ?? null,
          e.sessionId,
          e.userId,
          e.kind,
          e.platform ?? null,
        ],
      );
    } catch (err) {
      this.logger.warn(
        `[debrief] learner event ${e.kind} not recorded: ${(err as Error).message.slice(0, 200)}`,
      );
    }
  }

  /**
   * The pulse on this debrief, or null when it doesn't ask: not one of the
   * 1 in 10, or more than 8 weeks after the organisation's first live
   * debrief. Never throws — a failed read just asks nothing.
   */
  async pulseFor(
    view: { state: string; runId?: string },
    userId: number,
  ): Promise<DebriefPulseAnswers | null> {
    if (view.state !== 'ready' || !view.runId || !pulseSampled(view.runId)) {
      return null;
    }
    try {
      const [inWindow] = await this.dataSource.query(
        `SELECT r.tenant_id,
                (SELECT min(f."createdAt") FROM debrief_runs f
                  WHERE f.tenant_id = r.tenant_id AND f.mode = 'live'
                    AND f.status IN ('published','below_bar'))
                  + make_interval(weeks => $2) > now() AS open
           FROM debrief_runs r WHERE r.id = $1 AND r.mode = 'live'`,
        [view.runId, PULSE_WEEKS],
      );
      if (!inWindow?.open) return null;
      const rows: Array<{ kind: string }> = await this.dataSource.query(
        `SELECT kind FROM debrief_learner_events
          WHERE "runId" = $1 AND "userId" = $2 AND kind LIKE 'pulse\_%'`,
        [view.runId, userId],
      );
      const kinds = new Set(rows.map((r) => r.kind));
      const answer = (q: DebriefPulseQuestion) =>
        kinds.has(`pulse_${q}_yes`)
          ? true
          : kinds.has(`pulse_${q}_no`)
            ? false
            : null;
      return { knew_next: answer('knew_next'), fair: answer('fair') };
    } catch (err) {
      this.logger.warn(
        `[debrief] pulse not read: ${(err as Error).message.slice(0, 200)}`,
      );
      return null;
    }
  }

  /**
   * One pulse answer from the learner who did the session, on a debrief the
   * pulse asks on; answering again replaces the earlier answer.
   */
  async answerPulse(
    sessionId: string,
    userId: number,
    question: DebriefPulseQuestion,
    answer: boolean,
    platform: DebriefPlatform | null,
  ): Promise<{ ok: true }> {
    const [s] = await this.dataSource.query(
      `SELECT "counselorId" AS counselor_id, tenant_id FROM scenario_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!s || Number(s.counselor_id) !== Number(userId)) {
      throw new ForbiddenException('Not your session');
    }
    const [run] = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE "scenarioSessionId" = $1 AND mode = 'live'
          AND status IN ('published','below_bar')`,
      [sessionId],
    );
    if (
      !run ||
      !(await this.pulseFor({ state: 'ready', runId: run.id }, userId))
    ) {
      throw new NotFoundException('This debrief has no pulse');
    }
    const other = `pulse_${question}_${answer ? 'no' : 'yes'}`;
    await this.dataSource.query(
      `DELETE FROM debrief_learner_events
        WHERE "scenarioSessionId" = $1 AND "userId" = $2 AND kind = $3`,
      [sessionId, userId, other],
    );
    await this.record({
      sessionId,
      userId,
      kind: `pulse_${question}_${answer ? 'yes' : 'no'}` as DebriefLearnerEventKind,
      platform,
      tenantId: s.tenant_id ?? null,
      runId: run.id,
    });
    return { ok: true };
  }
}
