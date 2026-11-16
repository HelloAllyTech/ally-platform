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
  ListBugsQueryDto,
  StartBugDto,
} from '../dto/board.dto';
import { BughunterDbService } from './bughunter-db.service';

/** Board tab -> the `bughunter.bugs` statuses it shows. */
export const TAB_STATUSES: Record<BoardTab, string[]> = {
  needs_you: ['needs_you'],
  failed: ['failed'],
  in_progress: ['queued', 'running'],
  backlog: ['backlog'],
  done: ['done'],
};

/** Statuses an admin may start from: Start fix (backlog) and Retry (failed). */
const STARTABLE = ['backlog', 'failed'];

export interface BoardBug {
  id: number;
  source: string;
  app: string | null;
  title: string;
  description: string;
  status: string;
  reason: string | null;
  reportId: number | null;
  runId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

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
    const rows = await ds.query(
      `SELECT id, source, app, title, description, status, reason, report_id,
              run_id, attempts, created_at, started_at, finished_at,
              count(*) OVER () AS total
         FROM bughunter.bugs
        WHERE status = ANY($1)
        ORDER BY ${tab === 'done' ? 'coalesce(finished_at, created_at) DESC' : 'created_at ASC'}, id
        LIMIT $2 OFFSET $3`,
      [TAB_STATUSES[tab], pageSize, (page - 1) * pageSize],
    );
    const countRows = await ds.query(
      `SELECT status, count(*) AS n FROM bughunter.bugs GROUP BY status`,
    );
    const byStatus = new Map<string, number>(
      countRows.map((r: any) => [r.status, Number(r.n)]),
    );
    const counts = Object.fromEntries(
      BOARD_TABS.map((t) => [
        t,
        TAB_STATUSES[t].reduce((n, s) => n + (byStatus.get(s) ?? 0), 0),
      ]),
    ) as Record<BoardTab, number>;
    return {
      tab,
      page,
      pageSize,
      total: rows.length ? Number(rows[0].total) : 0,
      counts,
      items: (rows as any[]).map(
        (r: any): BoardBug => ({
          id: Number(r.id),
          source: r.source,
          app: r.app ?? null,
          title: r.title,
          description: r.description ?? '',
          status: r.status,
          reason: r.reason ?? null,
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
