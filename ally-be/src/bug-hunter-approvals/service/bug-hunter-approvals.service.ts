import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { CreateVerdictDto, ListReportsQueryDto } from '../dto/verdict.dto';
import { BughunterDbService } from './bughunter-db.service';

/** Reports a human judges: a verified suggested fix, or an escalation. */
export const JUDGEABLE_STATUSES = ['suggested_fix', 'escalated'];

export interface ReportListItem {
  id: number;
  createdAt: string;
  app: string;
  source: string;
  status: string;
  title: string;
  severity: string | null;
  confidence: string | null;
  riskLevel: string | null;
  verdict: { diagnosis: string; fix: string; decidedAt: string } | null;
}

/**
 * Bug Hunter v2 reports and verdicts (chunk 09). Reads `bughunter.reports`, writes
 * `bughunter.verdicts`. A new verdict on a report becomes the active one; the
 * previous one is kept and points at it (`superseded_by`), and the bug hunter's
 * feedback job retracts what the old one taught.
 */
@Injectable()
export class BugHunterApprovalsService {
  constructor(
    private readonly db: BughunterDbService,
    private readonly audit: AuditLogService,
  ) {}

  async list(query: ListReportsQueryDto): Promise<ReportListItem[]> {
    const ds = await this.db.get();
    const where = ['r.status = ANY($1)'];
    const params: unknown[] = [JUDGEABLE_STATUSES];
    const status = query.status ?? 'open';
    if (status === 'open') where.push('v.id IS NULL');
    if (status === 'judged') where.push('v.id IS NOT NULL');
    if (query.app) {
      params.push(query.app);
      where.push(`r.app = $${params.length}`);
    }
    if (query.source) {
      params.push(query.source);
      where.push(`r.source = $${params.length}`);
    }
    const rows = await ds.query(
      `SELECT r.id, r.created_at, r.app, r.source, r.status, r.title, r.severity,
              r.confidence, r.risk_level,
              v.diagnosis, v.fix, v.created_at AS decided_at
         FROM bughunter.reports r
         LEFT JOIN bughunter.verdicts v
           ON v.report_id = r.id AND v.superseded_by IS NULL
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT 200`,
      params,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      app: r.app,
      source: r.source,
      status: r.status,
      title: r.title,
      severity: r.severity ?? null,
      confidence: r.confidence ?? null,
      riskLevel: r.risk_level ?? null,
      verdict: r.diagnosis
        ? {
            diagnosis: r.diagnosis,
            fix: r.fix,
            decidedAt: new Date(r.decided_at).toISOString(),
          }
        : null,
    }));
  }

  async detail(id: number) {
    const ds = await this.db.get();
    const [report] = await ds.query(
      `SELECT * FROM bughunter.reports WHERE id = $1 AND status = ANY($2)`,
      [id, JUDGEABLE_STATUSES],
    );
    if (!report) throw new NotFoundException('No such Bug Hunter report.');
    const verdicts = await ds.query(
      `SELECT id, diagnosis, fix, reason, decided_by, source, created_at,
              superseded_by, superseded_at
         FROM bughunter.verdicts WHERE report_id = $1 ORDER BY id DESC`,
      [id],
    );
    return {
      id: Number(report.id),
      createdAt: new Date(report.created_at).toISOString(),
      runId: report.run_id || null,
      app: report.app,
      source: report.source,
      status: report.status,
      title: report.title,
      severity: report.severity ?? null,
      confidence: report.confidence ?? null,
      riskLevel: report.risk_level ?? null,
      stopReason: report.stop_reason ?? null,
      rootCause: report.root_cause ?? null,
      finding: report.finding ?? null,
      repro: report.repro ?? null,
      patchDiff: report.patch_diff ?? null,
      review: report.review ?? null,
      verdicts: verdicts.map((v: any) => ({
        id: Number(v.id),
        diagnosis: v.diagnosis,
        fix: v.fix,
        reason: v.reason,
        decidedBy: v.decided_by,
        source: v.source,
        decidedAt: new Date(v.created_at).toISOString(),
        active: v.superseded_by === null,
        supersededAt: v.superseded_at
          ? new Date(v.superseded_at).toISOString()
          : null,
      })),
    };
  }

  async recordVerdict(reportId: number, dto: CreateVerdictDto, userId: number) {
    const ds = await this.db.get();
    const [report] = await ds.query(
      `SELECT id, run_id, app, patch_diff FROM bughunter.reports
        WHERE id = $1 AND status = ANY($2)`,
      [reportId, JUDGEABLE_STATUSES],
    );
    if (!report) throw new NotFoundException('No such Bug Hunter report.');
    if (dto.fix !== 'none' && !report.patch_diff) {
      throw new BadRequestException(
        'This report has no suggested patch, so the fix verdict must be "none".',
      );
    }
    if (dto.diagnosis === 'not_a_bug' && !['none', 'wrong'].includes(dto.fix)) {
      throw new BadRequestException(
        'If it is not a bug, the fix can only be "none" or "wrong".',
      );
    }
    let created: any;
    let supersededIds: number[] = [];
    try {
      await ds.transaction(async (m) => {
        const active = await m.query(
          `SELECT id FROM bughunter.verdicts
            WHERE report_id = $1 AND superseded_by IS NULL FOR UPDATE`,
          [reportId],
        );
        supersededIds = active.map((r: any) => Number(r.id));
        // the old row stops being active before the new one is inserted, so the
        // one-active-verdict-per-report index never sees two
        if (supersededIds.length) {
          await m.query(
            `UPDATE bughunter.verdicts SET superseded_by = -1 WHERE id = ANY($1)`,
            [supersededIds],
          );
        }
        [created] = await m.query(
          `INSERT INTO bughunter.verdicts
             (run_id, app, diagnosis, fix, reason, decided_by, source, report_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'dashboard', $7)
           RETURNING id, created_at`,
          [
            report.run_id || '',
            report.app,
            dto.diagnosis,
            dto.fix,
            dto.reason,
            String(userId),
            reportId,
          ],
        );
        if (supersededIds.length) {
          await m.query(
            `UPDATE bughunter.verdicts
                SET superseded_by = $1, superseded_at = now()
              WHERE id = ANY($2)`,
            [created.id, supersededIds],
          );
        }
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(
          'Someone else recorded a verdict on this report at the same time. Reload and try again.',
        );
      }
      throw error;
    }
    const amended = supersededIds.length > 0;
    await this.audit.log({
      eventType: amended
        ? 'BUG_HUNTER_V2_VERDICT_AMENDED'
        : 'BUG_HUNTER_V2_VERDICT_RECORDED',
      userId,
      details: {
        reportId,
        verdictId: Number(created.id),
        supersededVerdictIds: supersededIds,
        diagnosis: dto.diagnosis,
        fix: dto.fix,
      },
    });
    return {
      id: Number(created.id),
      reportId,
      diagnosis: dto.diagnosis,
      fix: dto.fix,
      amended,
      supersededVerdictIds: supersededIds,
      decidedAt: new Date(created.created_at).toISOString(),
    };
  }
}
