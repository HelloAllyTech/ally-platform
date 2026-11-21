import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import {
  BOARD_TABS,
  BoardTab,
  BugHunterV2Mode,
  BUG_HUNTER_V2_APPS,
  DismissBugDto,
  DismissReason,
  ListBugsQueryDto,
  StartBugDto,
} from '../dto/board.dto';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { resolveReleaseTarget } from 'src/release/constants/release-targets.constants';
import { ProductionReleaseService } from 'src/release/service/production-release.service';
import { BugHunterApprovalsService } from './bug-hunter-approvals.service';
import { BughunterDbService } from './bughunter-db.service';

/** Board tab -> the `bughunter.bugs` statuses it shows. */
export const TAB_STATUSES: Record<BoardTab, string[]> = {
  needs_you: ['needs_you'],
  failed: ['failed'],
  // a draft PR is still Bug Hunter's case until a person merges it (as on v1's board)
  in_progress: ['queued', 'running', 'pr_open'],
  backlog: ['backlog'],
  done: ['done', 'merged', 'released'],
};

/** Statuses an admin may dismiss from (chunk 11). */
const DISMISSABLE = ['backlog', 'needs_you', 'failed', 'pr_open'];

/** What a dismissal teaches, when the bug has a report to judge (chunk 11). */
const DISMISS_VERDICT: Partial<
  Record<
    DismissReason,
    { diagnosis: 'not_a_bug' | 'wrong'; fix: 'none' | 'wrong' }
  >
> = {
  not_a_bug: { diagnosis: 'not_a_bug', fix: 'none' },
  wrong_diagnosis: { diagnosis: 'wrong', fix: 'wrong' },
};

const DISMISS_LABEL: Record<DismissReason, string> = {
  not_a_bug: 'not a bug',
  duplicate: 'duplicate',
  wont_fix: "won't fix",
  wrong_diagnosis: 'wrong diagnosis',
};

/** Statuses an admin may start from: Start fix (backlog) and Retry (failed). */
const STARTABLE = ['backlog', 'failed'];

/**
 * Where a board row lives. `v2` rows are `bughunter.bugs`, which v2's worker runs;
 * `v1` rows are the old Bug Hunter's `public.bug_findings`, read live and never
 * copied, so the board carries the whole history and v1's own status changes show
 * up as they happen. v2 never runs, starts or edits a v1 row.
 */
export type BoardOrigin = 'v2' | 'v1';

export interface BoardBug {
  origin: BoardOrigin;
  /** `bughunter.bugs.id` for a v2 row; null for a v1 row. */
  id: number | null;
  /** `bug_findings.id` for a v1 row; null for a v2 row. */
  v1FindingId: string | null;
  source: string;
  app: string | null;
  title: string;
  description: string;
  /** The row's own status: v2's queue status, or v1's finding status verbatim. */
  status: string;
  tab: BoardTab;
  reason: string | null;
  severity: string | null;
  prUrl: string | null;
  reportStatus: string | null;
  releaseTag: string | null;
  lastAction: { status: string; result: string | null } | null;
  reportId: number | null;
  runId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * v1's seventeen finding statuses onto the five tabs, exactly as v1's own board
 * groups them (`ally-admin-dashboard/src/pages/BugHunter/lifecycleBucket.ts`,
 * `bucketOfStatus`), so a bug sits under the same tab on both boards.
 * v1 also lifts a `coordinating` plan with an attention flag into Needs you; that
 * flag is computed per request by v1's detail endpoint, so here it stays In progress.
 */
export const V1_STATUS_TAB: Record<string, BoardTab> = {
  pending_approval: 'needs_you',
  needs_input: 'needs_you',
  failed: 'failed',
  release_failed: 'failed',
  queued: 'in_progress',
  fixing: 'in_progress',
  coordinating: 'in_progress',
  releasing: 'in_progress',
  pr_opened: 'in_progress',
  new: 'backlog',
  approved: 'backlog',
  blocked: 'backlog',
  merged: 'done',
  released: 'done',
  dismissed: 'done',
  rejected: 'done',
  cancelled: 'done',
};

const caseOf = (
  column: string,
  map: Record<string, string>,
  fallback: string,
) =>
  `CASE ${column} ${Object.entries(map)
    .map(([k, v]) => `WHEN '${k}' THEN '${v}'`)
    .join(' ')} ELSE '${fallback}' END`;

const V2_STATUS_TAB: Record<string, BoardTab> = Object.fromEntries(
  (Object.entries(TAB_STATUSES) as [BoardTab, string[]][]).flatMap(
    ([tab, statuses]) => statuses.map((s) => [s, tab]),
  ),
);

/**
 * Every bug on the board: v2's queue plus v1's findings, one row each, with its tab.
 * v1's plan steps (`parent_finding_id`) are left out, as v1's own reports do. A bug
 * reported after v2 was set up has a row on both sides; the v1 copy is dropped so it
 * counts once. v1's timestamps are UTC without a zone.
 */
export const BOARD_ROWS_SQL = `
  SELECT 'v2' AS origin, b.id, NULL::text AS v1_finding_id, b.source, b.app, b.title,
         b.description, b.status, ${caseOf('b.status', V2_STATUS_TAB, 'backlog')} AS tab,
         b.reason, NULL::text AS severity, b.pr_url, b.report_id, b.run_id,
         b.attempts, b.created_at, b.started_at, b.finished_at,
         (SELECT r.status FROM bughunter.reports r WHERE r.id = b.report_id)
           AS report_status,
         b.release_tag,
         (SELECT a.status || '|' || coalesce(a.result, '') FROM bughunter.actions a
           WHERE a.bug_id = b.id ORDER BY a.id DESC LIMIT 1) AS last_action
    FROM bughunter.bugs b
  UNION ALL
  SELECT 'v1', NULL, f.id::text, 'v1:' || f.source, f.repo, f.title, f.description,
         f.status, ${caseOf('f.status', V1_STATUS_TAB, 'backlog')},
         coalesce(f.escalation_question, f.decision_reason), f.severity, f.pr_url,
         NULL, f.run_id::text, 0,
         f."createdAt" AT TIME ZONE 'UTC', f.dispatched_at AT TIME ZONE 'UTC',
         coalesce(f.released_at, f.decided_at, f.cancelled_at,
                  CASE WHEN f.status IN ('merged', 'released', 'dismissed', 'rejected',
                                         'cancelled') THEN f."updatedAt" END)
           AT TIME ZONE 'UTC',
         NULL, f.release_tag, NULL
    FROM public.bug_findings f
   WHERE f.parent_finding_id IS NULL
     AND NOT (f.reported_bug_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM bughunter.bugs b2
            WHERE b2.signal_key = 'reported:' || f.reported_bug_id::text))`;

const iso = (v: unknown): string | null =>
  v ? new Date(v as string).toISOString() : null;

/**
 * Bug Hunter v2's board and modes (chunk 10). Reads and writes `bughunter.bugs`
 * and `bughunter.settings` in ally-be's own database (schema `bughunter`); the bug
 * hunter's worker does the runs. Every mode change and every Start fix / Retry is
 * audited.
 */
@Injectable()
export class BugHunterBoardService {
  private readonly logger = new Logger(BugHunterBoardService.name);

  constructor(
    private readonly db: BughunterDbService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
    // chunk 11: Merge and Release reuse the old Bug Hunter's GitHub services, and a
    // Merge or a Dismiss fills in the verdict
    private readonly github?: GithubActionsService,
    private readonly releases?: ProductionReleaseService,
    private readonly verdicts?: BugHunterApprovalsService,
  ) {}

  async settings() {
    const ds = await this.db.get();
    const [row] = await ds.query(
      `SELECT mode, daily_run_limit, updated_by, updated_at,
              (SELECT count(*) FROM bughunter.bugs
                WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
                                    AT TIME ZONE 'Asia/Kolkata') AS started_today
         FROM bughunter.settings WHERE id = 1`,
    );
    return {
      mode: (row?.mode ?? 'off') as BugHunterV2Mode,
      dailyRunLimit: Number(row?.daily_run_limit ?? 10),
      startedToday: Number(row?.started_today ?? 0),
      updatedBy: row?.updated_by ?? null,
      updatedAt: iso(row?.updated_at),
    };
  }

  async setMode(mode: BugHunterV2Mode, userId: number) {
    const ds = await this.db.get();
    const before = await this.settings();
    await ds.query(
      `UPDATE bughunter.settings SET mode = $1, updated_by = $2, updated_at = now()
        WHERE id = 1`,
      [mode, userId],
    );
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_MODE_CHANGED',
      userId,
      details: { from: before.mode, to: mode },
    });
    return this.settings();
  }

  async list(query: ListBugsQueryDto) {
    const ds = await this.db.get();
    const tab: BoardTab = query.tab ?? 'needs_you';
    const pageSize = query.pageSize ?? 50;
    const page = query.page ?? 1;
    const order =
      tab === 'done'
        ? 'coalesce(finished_at, created_at) DESC'
        : 'created_at ASC';
    const rows = await ds.query(
      `SELECT *, count(*) OVER () AS total
         FROM (${BOARD_ROWS_SQL}) board
        WHERE tab = $1
        ORDER BY ${order}, origin DESC, id, v1_finding_id
        LIMIT $2 OFFSET $3`,
      [tab, pageSize, (page - 1) * pageSize],
    );
    const countRows = await ds.query(
      `SELECT tab, count(*) AS n FROM (${BOARD_ROWS_SQL}) board GROUP BY tab`,
    );
    const byTab = new Map<string, number>(
      countRows.map((r: any) => [r.tab, Number(r.n)]),
    );
    const counts = Object.fromEntries(
      BOARD_TABS.map((t) => [t, byTab.get(t) ?? 0]),
    ) as Record<BoardTab, number>;
    return {
      tab,
      page,
      pageSize,
      total: rows.length ? Number(rows[0].total) : 0,
      counts,
      items: (rows as any[]).map(
        (r: any): BoardBug => ({
          origin: r.origin,
          id: r.id === null || r.id === undefined ? null : Number(r.id),
          v1FindingId: r.v1_finding_id ?? null,
          source: r.source,
          app: r.app ?? null,
          title: r.title,
          description: r.description ?? '',
          status: r.status,
          tab: r.tab,
          reason: r.reason ?? null,
          severity: r.severity ?? null,
          prUrl: r.pr_url ?? null,
          reportStatus: r.report_status ?? null,
          releaseTag: r.release_tag ?? null,
          // the latest Open PR request: pending, or how it ended
          lastAction: r.last_action
            ? {
                status: String(r.last_action).split('|')[0],
                result:
                  String(r.last_action).split('|').slice(1).join('|') || null,
              }
            : null,
          reportId: r.report_id ? Number(r.report_id) : null,
          runId: r.run_id ?? null,
          attempts: Number(r.attempts ?? 0),
          createdAt: new Date(r.created_at).toISOString(),
          startedAt: iso(r.started_at),
          finishedAt: iso(r.finished_at),
        }),
      ),
    };
  }

  /**
   * One of the old Bug Hunter's findings, read-only, with its history: so a v1 row
   * on the v2 board opens here rather than sending the reader to the old page.
   * Plan steps are not board rows, so they are not served either.
   */
  async v1Detail(findingId: string) {
    const ds = await this.db.get();
    const [f] = await ds.query(
      `SELECT id, source, repo, title, description, status, severity, file, evidence,
              pr_url, escalation_question, escalation_answer, decision_reason,
              decision_note, release_tag, "createdAt" AT TIME ZONE 'UTC' AS created_at,
              dispatched_at AT TIME ZONE 'UTC' AS dispatched_at,
              decided_at AT TIME ZONE 'UTC' AS decided_at,
              released_at AT TIME ZONE 'UTC' AS released_at
         FROM public.bug_findings
        WHERE id = $1 AND parent_finding_id IS NULL`,
      [findingId],
    );
    if (!f) throw new NotFoundException('No such bug.');
    const events = await ds.query(
      `SELECT stage, summary, "createdAt" AT TIME ZONE 'UTC' AS created_at
         FROM public.bug_hunt_events
        WHERE finding_id = $1
        ORDER BY "createdAt" ASC
        LIMIT 200`,
      [findingId],
    );
    return {
      origin: 'v1' as const,
      v1FindingId: f.id,
      source: `v1:${f.source}`,
      app: f.repo ?? null,
      title: f.title,
      description: f.description ?? '',
      status: f.status,
      tab: V1_STATUS_TAB[f.status] ?? 'backlog',
      severity: f.severity ?? null,
      file: f.file ?? null,
      evidence: f.evidence ?? null,
      prUrl: f.pr_url ?? null,
      escalationQuestion: f.escalation_question ?? null,
      escalationAnswer: f.escalation_answer ?? null,
      decisionReason: f.decision_reason ?? null,
      decisionNote: f.decision_note ?? null,
      releaseTag: f.release_tag ?? null,
      createdAt: new Date(f.created_at).toISOString(),
      startedAt: iso(f.dispatched_at),
      decidedAt: iso(f.decided_at),
      releasedAt: iso(f.released_at),
      events: (events as any[]).map((e) => ({
        stage: e.stage,
        summary: e.summary,
        at: new Date(e.created_at).toISOString(),
      })),
    };
  }

  /** Start fix (backlog) or Retry (failed): queue it for the worker. */
  async start(id: number, dto: StartBugDto, userId: number) {
    const ds = await this.db.get();
    const [bug] = await ds.query(
      `SELECT id, status, app FROM bughunter.bugs WHERE id = $1`,
      [id],
    );
    if (!bug) throw new NotFoundException('No such bug.');
    if (!STARTABLE.includes(bug.status)) {
      throw new ConflictException(
        bug.status === 'queued' || bug.status === 'running'
          ? 'This bug is already queued or running.'
          : 'Only a bug in Backlog or Failed can be started.',
      );
    }
    const from: string = bug.status;
    const app = dto.app ?? bug.app;
    if (!app) {
      throw new BadRequestException(
        'Pick the app this bug is in before starting the fix.',
      );
    }
    const [updated] = await ds.query(
      `UPDATE bughunter.bugs
          SET status = 'queued', app = $2, reason = NULL, queued_by = $3,
              updated_at = now()
        WHERE id = $1 AND status = ANY($4)
        RETURNING id`,
      [id, app, userId, STARTABLE],
    );
    // TypeORM returns [rows, affected] for UPDATE ... RETURNING on postgres
    const changed = Array.isArray(updated)
      ? updated.length > 0
      : Boolean(updated);
    if (!changed) {
      throw new ConflictException(
        'This bug changed meanwhile. Reload and try again.',
      );
    }
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_BUG_STARTED',
      userId,
      details: { bugId: id, from, app },
    });
    return { id, status: 'queued', app };
  }

  /**
   * A roadmap item of type "bug" (anyone can file one) enters Bug Hunter v2's
   * queue. Best effort: it never fails or delays the filing, and does nothing until
   * Bug Hunter v2 is set up in this database. The worker decides when it runs
   * (the mode); the reporter's text is scrubbed before any model sees it.
   */
  // ── chunk 11: the old Bug Hunter's buttons ────────────────────────────

  private async bugOr404(id: number) {
    const ds = await this.db.get();
    const [bug] = await ds.query(
      `SELECT b.id, b.status, b.app, b.title, b.report_id, b.pr_url, b.pr_number,
              r.status AS report_status, r.patch_diff
         FROM bughunter.bugs b LEFT JOIN bughunter.reports r ON r.id = b.report_id
        WHERE b.id = $1`,
      [id],
    );
    if (!bug) throw new NotFoundException('No such bug.');
    return { ds, bug };
  }

  /** Dismiss with a reason: the bug goes to Done; not-a-bug and wrong teach a verdict. */
  async dismiss(id: number, dto: DismissBugDto, userId: number) {
    const { ds, bug } = await this.bugOr404(id);
    if (!DISMISSABLE.includes(bug.status)) {
      throw new ConflictException(
        bug.status === 'queued' || bug.status === 'running'
          ? 'This bug is being worked on. Wait for the run to end.'
          : 'This bug is already closed.',
      );
    }
    const teaches = DISMISS_VERDICT[dto.reason];
    const reportId = bug.report_id ? Number(bug.report_id) : null;
    if (teaches && reportId && this.verdicts) {
      await this.verdicts
        .recordVerdict(
          reportId,
          {
            diagnosis: teaches.diagnosis,
            fix: bug.patch_diff ? teaches.fix : 'none',
            reason:
              dto.note?.trim() ||
              `Dismissed by an admin: ${DISMISS_LABEL[dto.reason]}.`,
          },
          userId,
        )
        .catch((error: unknown) =>
          // a report that is not judgeable (no bug, duplicate) still dismisses
          this.logger.warn(
            `No verdict for dismissed bug ${id}: ${(error as Error)?.message}`,
          ),
        );
    }
    await ds.query(
      `UPDATE bughunter.bugs
          SET status = 'done', dismissed_reason = $2, reason = $3,
              finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [
        id,
        dto.reason,
        `dismissed: ${DISMISS_LABEL[dto.reason]}${dto.note ? ` (${dto.note.trim().slice(0, 200)})` : ''}`,
      ],
    );
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_BUG_DISMISSED',
      userId,
      details: { bugId: id, from: bug.status, reason: dto.reason },
    });
    return { id, status: 'done' };
  }

  /** Put me on / Dismiss several bugs: each one's own result, like v1's bulk bar. */
  async bulk(
    action: 'start' | 'dismiss',
    ids: number[],
    reason: DismissReason | undefined,
    userId: number,
  ) {
    if (action === 'dismiss' && !reason) {
      throw new BadRequestException('Pick a reason to dismiss these bugs.');
    }
    const results: Array<{ id: number; ok: boolean; message?: string }> = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'start') await this.start(id, {}, userId);
        else await this.dismiss(id, { reason: reason! }, userId);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, message: (error as Error)?.message });
      }
    }
    return { action, results, done: results.filter((r) => r.ok).length };
  }

  /** Open PR on a suggested fix: queued for the worker, which has git and GitHub. */
  async openPr(id: number, userId: number) {
    const { ds, bug } = await this.bugOr404(id);
    if (bug.pr_url) {
      throw new ConflictException('This bug already has a PR.');
    }
    if (bug.status !== 'needs_you' || bug.report_status !== 'suggested_fix') {
      throw new ConflictException(
        'Only a suggested fix can be opened as a PR.',
      );
    }
    if (!bug.patch_diff) {
      throw new BadRequestException(
        'This report has no patch to open a PR from.',
      );
    }
    await ds.query(
      `INSERT INTO bughunter.actions (bug_id, kind, requested_by)
       VALUES ($1, 'open_pr', $2) ON CONFLICT DO NOTHING`,
      [id, userId],
    );
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_PR_REQUESTED',
      userId,
      details: { bugId: id },
    });
    return { id, queued: true };
  }

  /** Merge an open PR (a person's click, never automatic); it records the verdict. */
  async merge(id: number, userId: number) {
    const { ds, bug } = await this.bugOr404(id);
    if (bug.status !== 'pr_open' || !bug.pr_number) {
      throw new ConflictException('Only a bug with an open PR can be merged.');
    }
    if (!this.github) {
      throw new BadRequestException('GitHub is not available here.');
    }
    const result = await this.github.mergePullRequest(
      bug.app,
      Number(bug.pr_number),
      `fix(${bug.app}): ${bug.title}`.slice(0, 120),
    );
    if (!result.merged) {
      throw new ConflictException(
        `GitHub did not merge PR #${bug.pr_number}: ${result.message ?? 'no reason given'}`,
      );
    }
    await ds.query(
      `UPDATE bughunter.bugs
          SET status = 'merged', merged_at = now(), merged_by = $2, reason = NULL,
              finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [id, userId],
    );
    if (bug.report_id && this.verdicts) {
      await this.verdicts
        .recordVerdict(
          Number(bug.report_id),
          {
            diagnosis: 'correct',
            fix: 'worked',
            reason: 'Merged by an admin as Bug Hunter wrote it.',
          },
          userId,
        )
        .catch((error: unknown) =>
          this.logger.warn(
            `No verdict for merged bug ${id}: ${(error as Error)?.message}`,
          ),
        );
    }
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_PR_MERGED',
      userId,
      details: { bugId: id, pr: Number(bug.pr_number) },
    });
    return { id, status: 'merged' };
  }

  /** Release a merged fix: the app's production-release workflow, as v1 does. */
  async release(id: number, userId: number) {
    const { ds, bug } = await this.bugOr404(id);
    if (bug.status !== 'merged') {
      throw new ConflictException('Only a merged fix can be released.');
    }
    if (!this.releases) {
      throw new BadRequestException('Releases are not available here.');
    }
    const firstFile = /^\+\+\+ [a-z]\/(.+)$/m.exec(bug.patch_diff ?? '')?.[1];
    const target = resolveReleaseTarget(bug.app, firstFile);
    if (!target) {
      throw new BadRequestException(
        `Bug Hunter can't tell which ${bug.app} deployable this fix ships in. Release it from the Releases page.`,
      );
    }
    const { tag } = await this.releases.dispatch(target, 'master');
    await ds.query(
      `UPDATE bughunter.bugs
          SET status = 'released', released_at = now(), released_by = $2,
              release_tag = $3, updated_at = now()
        WHERE id = $1`,
      [id, userId, tag],
    );
    await this.audit.log({
      eventType: 'BUG_HUNTER_V2_RELEASED',
      userId,
      details: { bugId: id, tag, workflow: target.workflow },
    });
    return { id, status: 'released', tag };
  }

  async enqueueReported(input: {
    opportunityId: string;
    description: string;
    repo?: string | null;
  }): Promise<void> {
    try {
      const [schema] = await this.dataSource.query(
        `SELECT to_regclass('bughunter.bugs') IS NOT NULL AS present`,
      );
      if (!schema?.present) return;
      const app = (BUG_HUNTER_V2_APPS as readonly string[]).includes(
        input.repo ?? '',
      )
        ? input.repo
        : null;
      const title =
        input.description.trim().split('\n')[0].slice(0, 200) || 'Reported bug';
      await this.dataSource.query(
        `INSERT INTO bughunter.bugs
           (source, signal_key, app, title, description, payload, reported_by)
         VALUES ('reported', $1, $2, $3, $4, $5, 'user')
         ON CONFLICT (signal_key) DO NOTHING`,
        [
          `reported:${input.opportunityId}`,
          app,
          title,
          input.description.slice(0, 20000),
          JSON.stringify({ ref: input.opportunityId }),
        ],
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue reported bug ${input.opportunityId} for Bug Hunter v2: ${
          (error as Error)?.message
        }`,
      );
    }
  }
}
