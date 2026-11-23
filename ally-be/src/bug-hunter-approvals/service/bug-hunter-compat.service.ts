import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { BugHuntEvent } from 'src/bug-hunter/entity/bug-hunt-event.entity';
import {
  toEventDto,
  toFindingDto,
} from 'src/bug-hunter/legacy-finding.serializer';
import { BugHuntEventStage } from 'src/bug-hunter/enum/bug-hunt-event.enum';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from 'src/bug-hunter/enum/bug-finding.enum';
import { resolveReleaseTarget } from 'src/release/constants/release-targets.constants';
import { DismissReason } from '../dto/board.dto';
import { BugHunterBoardService } from './bug-hunter-board.service';
import { BughunterDbService } from './bughunter-db.service';

/** A v2 bug's id as the old Bug Hunter's page sees it: never a v1 finding's uuid. */
export const V2_ID_PREFIX = 'v2-';
export const toCompatId = (id: number | string) => `${V2_ID_PREFIX}${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The old Bug Hunter's history is read-only: its engine is gone (2026-11-23). */
export const OLD_HISTORY_READ_ONLY =
  "This is the old Bug Hunter's history, kept read-only. File it again to have Bug Hunter work on it.";
export const fromCompatId = (id: string): number => {
  if (UUID.test(id)) throw new ConflictException(OLD_HISTORY_READ_ONLY);
  const n = id.startsWith(V2_ID_PREFIX)
    ? Number(id.slice(V2_ID_PREFIX.length))
    : NaN;
  if (!Number.isInteger(n) || n <= 0)
    throw new NotFoundException('No such bug.');
  return n;
};

const SOURCE: Record<string, BugFindingSource> = {
  reported: BugFindingSource.REPORTED_BUG,
  issue: BugFindingSource.REPORTED_BUG,
  ci_failure: BugFindingSource.TEST_FAILURE,
  error_log: BugFindingSource.PRODUCTION_LOG,
  commit_sweep: BugFindingSource.CODE_REVIEW,
};

/**
 * A v2 status, plus its report's outcome, as the old page's status — chosen so each bug
 * lands under the same tab and offers the old page's button for v2's next step:
 * a suggested fix is "pending approval" (Approve = Open PR), an escalation "needs
 * input", a draft PR "PR opened" (Merge), and so on.
 */
export function compatStatus(
  status: string,
  reportStatus: string | null,
): BugFindingStatus {
  switch (status) {
    case 'backlog':
      return BugFindingStatus.NEW;
    case 'queued':
      return BugFindingStatus.QUEUED;
    case 'running':
      return BugFindingStatus.FIXING;
    case 'needs_you':
      return reportStatus === 'suggested_fix'
        ? BugFindingStatus.PENDING_APPROVAL
        : BugFindingStatus.NEEDS_INPUT;
    case 'pr_open':
      return BugFindingStatus.PR_OPENED;
    case 'merged':
      return BugFindingStatus.MERGED;
    case 'released':
      return BugFindingStatus.RELEASED;
    case 'failed':
      return BugFindingStatus.FAILED;
    default:
      return BugFindingStatus.DISMISSED;
  }
}

const DECISION: Record<string, BugFindingDecisionReason> = {
  not_a_bug: BugFindingDecisionReason.NOT_A_BUG,
  duplicate: BugFindingDecisionReason.DUPLICATE,
  wont_fix: BugFindingDecisionReason.WONT_FIX,
  wrong_diagnosis: BugFindingDecisionReason.OTHER,
};

/** The old page's decline reasons, onto v2's dismissals. */
const DISMISS_FROM_V1: Record<string, DismissReason> = {
  not_a_bug: 'not_a_bug',
  duplicate: 'duplicate',
  wont_fix: 'wont_fix',
  too_risky: 'wont_fix',
  wrong_repo: 'wrong_diagnosis',
  other: 'wont_fix',
};

const CONFIDENCE: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };

const iso = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const firstFile = (diff: string | null) =>
  /^\+\+\+ [a-z]\/(.+)$/m.exec(diff ?? '')?.[1] ?? null;

/** The report's findings as the evidence block the old drawer shows. */
function evidenceOf(r: any): string | null {
  const parts: string[] = [];
  const finding = r.finding ?? {};
  if (r.root_cause) parts.push(`Root cause\n${r.root_cause}`);
  if (Array.isArray(finding.evidence) && finding.evidence.length) {
    parts.push(
      `Evidence\n${finding.evidence.map((e: string) => `- ${e}`).join('\n')}`,
    );
  }
  const repro = r.repro ?? {};
  if (repro.test_path) {
    parts.push(
      `Failing test\n${repro.test_path}${repro.test_name ? ` :: ${repro.test_name}` : ''}` +
        (repro.failure_excerpt
          ? `\n${String(repro.failure_excerpt).slice(0, 1500)}`
          : ''),
    );
  }
  if (r.patch_diff)
    parts.push(`Suggested fix\n${String(r.patch_diff).slice(0, 6000)}`);
  const notes = r.review?.notes;
  if (Array.isArray(notes) && notes.length) {
    parts.push(`Reviewer\n${notes.map((n: string) => `- ${n}`).join('\n')}`);
  }
  if (r.stop_reason) parts.push(`Why it stopped\n${r.stop_reason}`);
  return parts.length ? parts.join('\n\n') : null;
}

/**
 * Bug Hunter v2 in the old Bug Hunter's shapes (the "exact match" page, chunk 11):
 * the old page's own components render v2's queue through these, and the old page's
 * buttons map onto v2's actions. v1's own history is not here: the page reads it
 * from the old Bug Hunter's API, untouched.
 */
@Injectable()
export class BugHunterCompatService {
  constructor(
    private readonly db: BughunterDbService,
    private readonly board: BugHunterBoardService,
    // the old Bug Hunter's history (its tables, read through its kept entities)
    private readonly dataSource?: DataSource,
  ) {}

  /** Old findings (top-level), newest first, except bugs v2 also has (counted once). */
  private async oldFindings(limit: number) {
    if (!this.dataSource) return [];
    return this.dataSource
      .getRepository(BugFinding)
      .createQueryBuilder('f')
      .where('f.parent_finding_id IS NULL')
      .andWhere(
        `NOT (f.reported_bug_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM bughunter.bugs b
            WHERE b.signal_key = 'reported:' || f.reported_bug_id::text))`,
      )
      .orderBy('f.createdAt', 'DESC')
      .take(limit)
      .getMany()
      .catch(() => []);
  }

  private async rows(where = 'TRUE', params: unknown[] = []) {
    const ds = await this.db.get();
    return ds.query(
      `SELECT b.*, r.status AS report_status, r.root_cause, r.finding, r.repro,
              r.patch_diff, r.review, r.confidence, r.severity, r.stop_reason
         FROM bughunter.bugs b LEFT JOIN bughunter.reports r ON r.id = b.report_id
        WHERE ${where}
        ORDER BY b.created_at DESC, b.id DESC`,
      params,
    );
  }

  /** One v2 bug as the old page's finding (via the old page's own serializer). */
  toFinding(r: any) {
    const status = compatStatus(r.status, r.report_status);
    const reportedUuid =
      typeof r.signal_key === 'string' && r.signal_key.startsWith('reported:')
        ? r.signal_key.slice('reported:'.length)
        : null;
    const decided = status === BugFindingStatus.DISMISSED;
    const entity: any = {
      id: toCompatId(r.id),
      runId: null,
      repo: r.app ?? null,
      source: SOURCE[r.source] ?? BugFindingSource.REPORTED_BUG,
      title: r.title,
      description: r.description ?? '',
      file: firstFile(r.patch_diff),
      evidence: evidenceOf(r),
      severity: ['low', 'medium', 'high'].includes(r.severity)
        ? r.severity
        : null,
      proven: Boolean(r.repro?.test_path),
      touchesGuardedPath: false,
      reportedBugId: reportedUuid,
      status,
      prUrl: r.pr_url ?? null,
      escalationQuestion:
        status === BugFindingStatus.NEEDS_INPUT
          ? (r.stop_reason ?? r.reason ?? null)
          : null,
      decidedAt: decided ? iso(r.finished_at) : null,
      decisionReason: decided ? (DECISION[r.dismissed_reason] ?? null) : null,
      decisionNote: decided ? (r.reason ?? null) : null,
      metadata: {
        ...(r.confidence && CONFIDENCE[r.confidence] !== undefined
          ? { confidence: CONFIDENCE[r.confidence] }
          : {}),
        ...(r.pr_number && r.pr_url
          ? { pr: { number: Number(r.pr_number), url: r.pr_url, headSha: '' } }
          : {}),
      },
      budget: null,
      engine: 'bug-hunter-v2',
      model: null,
      releaseTag: r.release_tag ?? null,
      releasedBy: r.released_by ?? null,
      releasedAt: iso(r.released_at),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at ?? r.created_at),
    };
    return toFindingDto(entity);
  }

  /** v2's bugs first, then the old Bug Hunter's history, both in the old page's shape. */
  async list(limit = 100, offset = 0) {
    const rows = await this.rows();
    const ours = rows.map((r: any) => this.toFinding(r));
    const old = (await this.oldFindings(offset + limit)).map((f) =>
      toFindingDto(f),
    );
    const items = [...ours, ...old];
    return { items: items.slice(offset, offset + limit), count: items.length };
  }

  /** One old finding, read-only, with its timeline. */
  private async oldDetail(id: string) {
    const finding = this.dataSource
      ? await this.dataSource
          .getRepository(BugFinding)
          .findOne({ where: { id } })
      : null;
    if (!finding) throw new NotFoundException('No such bug.');
    const events = await this.dataSource!.getRepository(BugHuntEvent).find({
      where: { findingId: id },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    return {
      ...toFindingDto(finding),
      events: events.map((e) => toEventDto(e)),
      steps: [],
      releasable: false,
      releaseTarget: null,
      releaseBlockedReason: null,
    };
  }

  async detail(compatId: string) {
    if (UUID.test(compatId)) return this.oldDetail(compatId);
    const id = fromCompatId(compatId);
    const [r] = await this.rows('b.id = $1', [id]);
    if (!r) throw new NotFoundException('No such bug.');
    const finding = this.toFinding(r);
    const target =
      r.status === 'merged'
        ? resolveReleaseTarget(r.app, firstFile(r.patch_diff))
        : null;
    return {
      ...finding,
      events: this.events(r),
      steps: [],
      releasable: Boolean(target),
      releaseTarget: target?.label ?? null,
      releaseBlockedReason:
        r.status === 'merged' && !target
          ? `Bug Hunter can't tell which ${r.app} deployable this fix ships in. Release it from the Releases page.`
          : null,
    };
  }

  /** v2 keeps no event log; the bug's own timestamps make the old drawer's work log. */
  private events(r: any) {
    const ev = (stage: BugHuntEventStage, at: unknown, summary: string) =>
      at
        ? toEventDto({
            id: `${toCompatId(r.id)}-${stage}`,
            runId: null,
            repo: r.app ?? null,
            stage,
            summary,
            payload: null,
            suggestionId: null,
            findingId: toCompatId(r.id),
            createdAt: new Date(at as string),
          } as any)
        : null;
    return [
      ev(
        BugHuntEventStage.FINDER_RESULT,
        r.created_at,
        'Bug reported to Bug Hunter v2.',
      ),
      ev(
        BugHuntEventStage.SESSION_DISPATCHED,
        r.started_at,
        'Bug Hunter v2 started a run.',
      ),
      r.report_status === 'suggested_fix'
        ? ev(
            BugHuntEventStage.TEST_WRITTEN,
            r.finished_at,
            'Wrote a failing test and a fix.',
          )
        : r.status === 'failed'
          ? ev(
              BugHuntEventStage.ERROR,
              r.finished_at,
              r.reason ?? 'The run failed.',
            )
          : r.report_status === 'escalated'
            ? ev(
                BugHuntEventStage.ESCALATED,
                r.finished_at,
                r.stop_reason ?? 'Asked a person.',
              )
            : null,
      ev(
        BugHuntEventStage.PR_OPENED,
        r.pr_opened_at,
        `Opened a draft PR (${r.pr_opened_by ?? 'agent'}).`,
      ),
      ev(BugHuntEventStage.MERGED, r.merged_at, 'Merged by an admin.'),
      ev(
        BugHuntEventStage.RELEASED,
        r.released_at,
        `Released${r.release_tag ? ` as ${r.release_tag}` : ''}.`,
      ),
    ].filter(Boolean);
  }

  // ── the old page's buttons, onto v2's actions ──────────────────────────

  /** "Approve": for a suggested fix, Open PR; for a bug not started yet, Put me on it. */
  async approve(compatId: string, userId: number) {
    const id = fromCompatId(compatId);
    const [r] = await this.rows('b.id = $1', [id]);
    if (!r) throw new NotFoundException('No such bug.');
    if (r.status === 'needs_you' && r.report_status === 'suggested_fix') {
      await this.board.openPr(id, userId);
    } else {
      await this.board.start(id, {}, userId);
    }
    return this.detail(compatId);
  }

  async reject(
    compatId: string,
    reason: string,
    note: string | undefined,
    userId: number,
  ) {
    const mapped = DISMISS_FROM_V1[reason];
    if (!mapped)
      throw new BadRequestException('Pick a reason to decline this bug.');
    await this.board.dismiss(
      fromCompatId(compatId),
      { reason: mapped, note },
      userId,
    );
    return this.detail(compatId);
  }

  async start(compatId: string, userId: number) {
    await this.board.start(fromCompatId(compatId), {}, userId);
    return this.detail(compatId);
  }

  async merge(compatId: string, userId: number) {
    await this.board.merge(fromCompatId(compatId), userId);
    return this.detail(compatId);
  }

  async release(compatId: string, userId: number) {
    await this.board.release(fromCompatId(compatId), userId);
    return this.detail(compatId);
  }

  /** The mode, in the old page's words: its "AI" is v2's autonomous. */
  async settings() {
    const s = await this.board.settings();
    return {
      mode: s.mode === 'autonomous' ? 'ai' : s.mode,
      updatedBy: s.updatedBy,
      updatedAt: s.updatedAt ?? new Date().toISOString(),
    };
  }

  async setMode(mode: string, userId: number) {
    const v2 = mode === 'ai' ? 'autonomous' : mode;
    if (!['off', 'manual', 'autonomous'].includes(v2)) {
      throw new BadRequestException('Mode must be off, manual or ai.');
    }
    await this.board.setMode(v2 as any, userId);
    return this.settings();
  }
}
