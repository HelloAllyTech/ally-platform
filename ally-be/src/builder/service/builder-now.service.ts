import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildRunRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderMessageRole,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../enum/builder.enum';
import { BuilderDecision } from '../type/builder-decision.type';
import { BuilderDecisionService } from './builder-decision.service';
import { BuilderSettingsService } from './builder-settings.service';
import { BUILDER_TURN_LOCK_PREFIX } from '../constants/builder.constants';

/**
 * What a session in progress is waiting on, in the order the Now page groups
 * them: a person, nobody (it is stuck), Builder itself, or review.
 */
export type BuilderWaitingOn = 'you' | 'stuck' | 'builder' | 'review';

/**
 * A building session that has made no progress for this long, with no run
 * active and nothing asked of anyone, is Stuck. Two hours is longer than any
 * healthy run (the runner cap) and short enough to be seen the same day.
 */
export const BUILDER_STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export interface BuilderNowPullRequest {
  id: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  ciStatus: string | null;
  merged: boolean;
  state: string | null;
}

export interface BuilderNowSession {
  id: string;
  title: string;
  /** The roadmap opportunity's code (OPP-0646), or null for a session started by hand. */
  code: string | null;
  opportunityId: string | null;
  status: BuilderSessionStatus;
  currentStage: string | null;
  waitingOn: BuilderWaitingOn;
  /** Builder's current stage, in words: "Writing code", "Interview · thinking". */
  nowLine: string;
  /** Oldest pending decision's wait, when waitingOn is `you`. */
  waitingSince: string | null;
  /** When it stopped moving, when waitingOn is `stuck`. */
  stuckSince: string | null;
  pendingCount: number;
  pendingKinds: string[];
  /** An interview nobody has answered anything in yet: Put back is allowed. */
  putBackEligible: boolean;
  runSequence: number | null;
  pullRequests: BuilderNowPullRequest[];
  createdByName: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface BuilderNowResponse {
  sessions: BuilderNowSession[];
  decisions: BuilderDecision[];
  inProgress: number;
  limit: number;
}

const STAGE_WORDS: Record<string, string> = {
  [BuilderStage.SETUP]: 'Setting up',
  [BuilderStage.PLANNING]: 'Planning',
  [BuilderStage.CODING]: 'Writing code',
  [BuilderStage.TESTING]: 'Writing tests',
  [BuilderStage.GATE]: 'Running the checks',
  [BuilderStage.VERIFYING]: 'Verifying',
  [BuilderStage.REVIEWING]: 'Reviewing its own work',
  [BuilderStage.REMEDIATING]: 'Fixing what review found',
  [BuilderStage.FINALISING]: 'Finalising',
  [BuilderStage.E2E_VERIFY]: 'Checking end to end',
  [BuilderStage.OPENING_PRS]: 'Opening pull requests',
  [BuilderStage.REPORTING]: 'Writing its report',
  [BuilderStage.DONE]: 'Done',
};

const IN_PROGRESS_STATUSES = [
  BuilderSessionStatus.INTERVIEWING,
  BuilderSessionStatus.PRD_READY,
  BuilderSessionStatus.BUILDING,
  BuilderSessionStatus.WAITING_FOR_INPUT,
  BuilderSessionStatus.FAILED,
];

const openPullRequests = (pullRequests: BuilderPullRequest[]) =>
  pullRequests.filter((pr) => !pr.merged && pr.state !== 'closed');

/**
 * Which group a session belongs in. Pure, so the grouping the whole page
 * rests on is pinned by a spec rather than by a screenshot.
 */
export const waitingOnFor = (input: {
  status: BuilderSessionStatus;
  pendingCount: number;
  hasActiveRun: boolean;
  turnRunning: boolean;
  openPullRequests: number;
  updatedAt: Date;
  now?: Date;
}): BuilderWaitingOn => {
  if (input.pendingCount > 0) return 'you';
  if (input.status === BuilderSessionStatus.FAILED) return 'stuck';
  const now = input.now ?? new Date();
  const idle = now.getTime() - new Date(input.updatedAt).getTime();
  if (
    (input.status === BuilderSessionStatus.BUILDING ||
      input.status === BuilderSessionStatus.WAITING_FOR_INPUT) &&
    !input.hasActiveRun &&
    !input.turnRunning &&
    idle > BUILDER_STUCK_AFTER_MS
  ) {
    return 'stuck';
  }
  if (
    input.status === BuilderSessionStatus.COMPLETED &&
    input.openPullRequests > 0
  ) {
    return 'review';
  }
  return 'builder';
};

/** Builder's stage, in its own words, for the row's second line. */
export const nowLineFor = (input: {
  status: BuilderSessionStatus;
  currentStage: string | null;
  turnRunning: boolean;
  run: Pick<BuilderBuildRun, 'status' | 'sequence'> | null;
  openPullRequests: BuilderPullRequest[];
  pendingCount: number;
  error: string | null;
}): string => {
  const prs = input.openPullRequests;
  switch (input.status) {
    case BuilderSessionStatus.INTERVIEWING:
      if (input.turnRunning) return 'Interview · thinking';
      return input.pendingCount
        ? 'Interview · waiting on your answer'
        : 'Interview';
    case BuilderSessionStatus.PRD_READY:
      return 'PRD ready';
    case BuilderSessionStatus.BUILDING: {
      if (input.run?.status === BuilderRunStatus.QUEUED) {
        return `Run #${input.run.sequence} · waiting for a runner`;
      }
      const words =
        (input.currentStage && STAGE_WORDS[input.currentStage]) || 'Building';
      return input.run ? `${words} · run #${input.run.sequence}` : words;
    }
    case BuilderSessionStatus.WAITING_FOR_INPUT:
      return 'Paused, waiting for input';
    case BuilderSessionStatus.FAILED: {
      const reason = String(input.error ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return reason ? `Stopped: ${reason.slice(0, 90)}` : 'Stopped';
    }
    case BuilderSessionStatus.COMPLETED:
      if (prs.length === 1) {
        return `#${prs[0].prNumber} open · CI ${prs[0].ciStatus ?? 'pending'}`;
      }
      return prs.length ? `${prs.length} pull requests open` : 'Finished';
    default:
      return input.status;
  }
};

/**
 * The Now tab's one read: every session in progress, what it is waiting on,
 * the decisions waiting on a person, and how close the person is to their
 * limit — one snapshot, so the summary line, the groups and the card can
 * never disagree with each other.
 */
@Injectable()
export class BuilderNowService {
  private readonly logger = LoggerService.getInstance(BuilderNowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly decisionService: BuilderDecisionService,
    private readonly settingsService: BuilderSettingsService,
    private readonly redisService: RedisService,
  ) {}

  async now(): Promise<BuilderNowResponse> {
    const [decisions, settings, candidates] = await Promise.all([
      this.decisionService.listPending(),
      this.settingsService.get(),
      this.sessionRepository.find({
        where: { archivedAt: IsNull() },
        order: { createdAt: 'ASC' },
      }),
    ]);
    const ids = candidates.map((session) => session.id);
    const [pullRequests, runs, names, codes, answered] = await Promise.all([
      ids.length
        ? this.pullRequestRepository.find({ where: { sessionId: In(ids) } })
        : Promise.resolve([] as BuilderPullRequest[]),
      ids.length
        ? this.runRepository.find({
            where: {
              sessionId: In(ids),
              status: In(BUILDER_RUN_ACTIVE_STATUSES),
            },
          })
        : Promise.resolve([] as BuilderBuildRun[]),
      this.sessionRepository.findCreatorNames(
        candidates.map((session) => session.createdBy),
      ),
      this.opportunityCodes(ids),
      this.answeredCounts(ids),
    ]);

    const prsBySession = groupBy(pullRequests, (pr) => pr.sessionId);
    const runBySession = new Map(runs.map((run) => [run.sessionId, run]));
    const pendingBySession = groupBy(decisions, (d) => d.sessionId);

    const sessions: BuilderNowSession[] = [];
    for (const session of candidates) {
      const prs = prsBySession.get(session.id) ?? [];
      const open = openPullRequests(prs);
      const pending = pendingBySession.get(session.id) ?? [];
      const inProgress =
        IN_PROGRESS_STATUSES.includes(session.status) ||
        open.length > 0 ||
        pending.length > 0;
      if (!inProgress || session.status === BuilderSessionStatus.CANCELLED) {
        continue;
      }
      sessions.push(
        await this.toNowSession(session, {
          prs,
          open,
          pending,
          run: runBySession.get(session.id) ?? null,
          createdByName: names.get(session.createdBy) ?? null,
          opportunity: codes.get(session.id) ?? null,
          answered: answered.get(session.id) ?? 0,
        }),
      );
    }

    return {
      sessions,
      decisions,
      inProgress: sessions.length,
      limit: settings.inProgressLimit ?? 3,
    };
  }

  /** How many sessions are in progress, for the Start gate. */
  async inProgressCount(): Promise<{ inProgress: number; limit: number }> {
    const { inProgress, limit } = await this.now();
    return { inProgress, limit };
  }

  private async toNowSession(
    session: BuilderSession,
    ctx: {
      prs: BuilderPullRequest[];
      open: BuilderPullRequest[];
      pending: BuilderDecision[];
      run: BuilderBuildRun | null;
      createdByName: string | null;
      opportunity: { id: string; code: string } | null;
      answered: number;
    },
  ): Promise<BuilderNowSession> {
    const turnRunning = await this.turnRunning(session.id);
    const waitingOn = waitingOnFor({
      status: session.status,
      pendingCount: ctx.pending.length,
      hasActiveRun: !!ctx.run,
      turnRunning,
      openPullRequests: ctx.open.length,
      updatedAt: session.updatedAt,
    });
    const waits = ctx.pending.map((d) => new Date(d.waitingSince).getTime());
    return {
      id: session.id,
      title: session.title,
      code: ctx.opportunity?.code ?? null,
      opportunityId: ctx.opportunity?.id ?? null,
      status: session.status,
      currentStage: session.currentStage ?? null,
      waitingOn,
      nowLine: nowLineFor({
        status: session.status,
        currentStage: session.currentStage ?? null,
        turnRunning,
        run: ctx.run,
        openPullRequests: ctx.open,
        pendingCount: ctx.pending.length,
        error: session.error ?? null,
      }),
      waitingSince: waits.length
        ? new Date(Math.min(...waits)).toISOString()
        : null,
      stuckSince:
        waitingOn === 'stuck'
          ? new Date(session.updatedAt).toISOString()
          : null,
      pendingCount: ctx.pending.length,
      pendingKinds: ctx.pending.map((d) => d.kind),
      // The seed is the only user message an untouched interview has.
      putBackEligible:
        session.status === BuilderSessionStatus.INTERVIEWING &&
        ctx.answered <= 1 &&
        !turnRunning,
      runSequence: ctx.run?.sequence ?? null,
      pullRequests: ctx.prs.map((pr) => ({
        id: pr.id,
        repo: pr.repo,
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        ciStatus: pr.ciStatus ?? null,
        merged: pr.merged,
        state: pr.state ?? null,
      })),
      createdByName: ctx.createdByName,
      startedAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
    };
  }

  private async turnRunning(sessionId: string): Promise<boolean> {
    try {
      return !!(await this.redisService.get(
        `${BUILDER_TURN_LOCK_PREFIX}:${sessionId}`,
      ));
    } catch {
      return false;
    }
  }

  /**
   * The roadmap code for each session that came from an opportunity. A read of
   * the roadmap's table rather than an import of its module: the roadmap
   * depends on Builder, and the reverse edge is the one its entity warns
   * against. Fail-soft — a session without its code still renders.
   */
  private async opportunityCodes(
    sessionIds: string[],
  ): Promise<Map<string, { id: string; code: string }>> {
    if (!sessionIds.length) return new Map();
    try {
      const rows: { id: string; code: string; builderSessionId: string }[] =
        await this.dataSource.query(
          `SELECT id, code, "builderSessionId" FROM roadmap_opportunities WHERE "builderSessionId" = ANY($1)`,
          [sessionIds],
        );
      return new Map(
        rows.map((row) => [
          row.builderSessionId,
          { id: row.id, code: row.code },
        ]),
      );
    } catch (error) {
      this.logger.warn(
        `Could not read opportunity codes for the Now page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  /** User messages per session — an untouched interview has only its seed. */
  private async answeredCounts(
    sessionIds: string[],
  ): Promise<Map<string, number>> {
    if (!sessionIds.length) return new Map();
    const rows: { sessionId: string; count: string }[] =
      await this.dataSource.query(
        `SELECT "sessionId", COUNT(*)::int AS count FROM builder_messages WHERE role = $1 AND "sessionId" = ANY($2) GROUP BY "sessionId"`,
        [BuilderMessageRole.USER, sessionIds],
      );
    return new Map(rows.map((row) => [row.sessionId, Number(row.count)]));
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
