import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DEBRIEF_PLATFORMS,
  DebriefLearnerEventKind,
  DebriefPlatform,
} from '../entity/debrief-learner-event.entity';
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
}
