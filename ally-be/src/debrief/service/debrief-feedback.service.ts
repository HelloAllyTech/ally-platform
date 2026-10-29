import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
  DebriefFlagReason,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import { DebriefCards } from '../util/debrief-cards.util';
import { LearnerDebriefView } from './debrief-agent.service';

/** A learner can take a flag back for this long after sending it (plan §7.6). */
export const FLAG_UNDO_MS = 10 * 60 * 1000;

/** What the learner sees on a card after the Ally team reviewed their flag. */
export interface DebriefCorrection {
  section: string;
  outcome: 'kept' | 'removed';
  note: string | null;
  at: string;
}

/** The card a section key names, as text — what a reviewer reads beside the flag. */
export function sectionText(
  cards: DebriefCards | null,
  section: string,
): string | null {
  if (!cards) return null;
  const m = /^(what_worked|work_on_this)\[(\d+)\]$/.exec(section);
  if (m) {
    const card = (cards[m[1] as 'what_worked' | 'work_on_this'] ?? [])[
      Number(m[2])
    ] as unknown as Record<string, string | number> | undefined;
    if (!card) return null;
    return [
      card.lead,
      card.quote ? `“${card.quote}”` : '',
      card.body ?? card.why,
      card.try_saying,
    ]
      .filter(Boolean)
      .join(' ');
  }
  switch (section) {
    case 'important_moment':
      return cards.important_moment
        ? `${cards.important_moment.lead} “${cards.important_moment.quote}” ${cards.important_moment.body}`
        : null;
    case 'opening':
      return cards.opening ?? null;
    case 'practise_next':
      return cards.practise_next
        ? `${cards.practise_next.skill}. ${cards.practise_next.reason}`
        : null;
    case 'reflective_question':
      return cards.reflective_question ?? null;
    case 'progress_note':
      return cards.progress_note ?? null;
    default:
      return null;
  }
}

/**
 * Learners' "Was this helpful?" answers and "This isn't right" flags, and the
 * Ally team's review queue: live debriefs a person must finish, and open
 * flags. Every action is on the learner's own live debrief, or behind the
 * Console's toggle.
 */
@Injectable()
export class DebriefFeedbackService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    @InjectRepository(DebriefFeedback)
    private readonly feedback: Repository<DebriefFeedback>,
  ) {}

  /** The learner's own published live debrief, or a refusal. */
  private async ownLiveRun(
    sessionId: string,
    userId: number,
  ): Promise<DebriefRun> {
    const [s] = await this.dataSource.query(
      `SELECT "counselorId" AS counselor_id FROM scenario_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!s || Number(s.counselor_id) !== Number(userId)) {
      throw new ForbiddenException('Not your session');
    }
    const run = await this.runs.findOne({
      where: { scenarioSessionId: sessionId, mode: DebriefRunMode.LIVE },
    });
    if (
      !run ||
      ![DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      )
    ) {
      throw new NotFoundException(
        'This session has no debrief to give feedback on',
      );
    }
    return run;
  }

  async setHelpful(sessionId: string, userId: number, helpful: boolean) {
    const run = await this.ownLiveRun(sessionId, userId);
    await this.dataSource.query(
      `INSERT INTO debrief_run_feedback
         (tenant_id, "runId", "scenarioSessionId", "userId", kind, helpful, status)
       VALUES ($1, $2, $3, $4, 'helpful', $5, 'noted')
       ON CONFLICT ("runId", "userId") WHERE kind = 'helpful'
       DO UPDATE SET helpful = EXCLUDED.helpful, "updatedAt" = now()`,
      [run.tenantId ?? null, run.id, sessionId, userId, helpful],
    );
    return { helpful };
  }

  async flag(
    sessionId: string,
    userId: number,
    input: { section: string; reason: DebriefFlagReason; note?: string | null },
  ) {
    const run = await this.ownLiveRun(sessionId, userId);
    if (!sectionText(run.cards as unknown as DebriefCards, input.section)) {
      throw new BadRequestException('There is no such card in this debrief');
    }
    const existing = await this.feedback.findOne({
      where: {
        runId: run.id,
        userId,
        kind: DebriefFeedbackKind.FLAG,
        section: input.section,
      },
    });
    if (existing && existing.status !== DebriefFeedbackStatus.WITHDRAWN) {
      throw new ConflictException('You have already flagged this card');
    }
    const row =
      existing ??
      this.feedback.create({
        tenantId: run.tenantId ?? null,
        runId: run.id,
        scenarioSessionId: sessionId,
        userId,
        kind: DebriefFeedbackKind.FLAG,
        section: input.section,
      });
    Object.assign(row, {
      reason: input.reason,
      note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
      // A flag on the important moment is about safety: it jumps the queue.
      urgent:
        input.section === 'important_moment' ||
        input.section.startsWith('important_moment.'),
      status: DebriefFeedbackStatus.OPEN,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    });
    const saved = await this.feedback.save(row);
    return {
      id: saved.id,
      section: saved.section,
      status: saved.status,
      undoUntil: new Date(Date.now() + FLAG_UNDO_MS).toISOString(),
    };
  }

  async undoFlag(sessionId: string, userId: number, flagId: string) {
    await this.ownLiveRun(sessionId, userId);
    const row = await this.feedback.findOne({ where: { id: flagId, userId } });
    if (!row || row.scenarioSessionId !== sessionId)
      throw new NotFoundException('Flag not found');
    if (row.status !== DebriefFeedbackStatus.OPEN) {
      throw new ConflictException('This flag has already been reviewed');
    }
    if (Date.now() - new Date(row.updatedAt).getTime() > FLAG_UNDO_MS) {
      throw new ConflictException('It is too late to undo this flag');
    }
    row.status = DebriefFeedbackStatus.WITHDRAWN;
    await this.feedback.save(row);
    return { id: row.id, status: row.status };
  }

  /**
   * The learner's view with their own feedback and the review outcomes. Cards
   * stay as stored: the apps hide a removed card by its stored index (the
   * same index its flag names) and show the outcome, so nothing shifts.
   */
  async decorate(view: LearnerDebriefView, userId: number) {
    if (view.state !== 'ready' || !view.runId || !view.cards) return view;
    const rows = await this.feedback.find({ where: { runId: view.runId } });
    const corrections: DebriefCorrection[] = rows
      .filter(
        (r) =>
          r.status === DebriefFeedbackStatus.KEPT ||
          r.status === DebriefFeedbackStatus.REMOVED,
      )
      .map((r) => ({
        section: r.section!,
        outcome: r.status === DebriefFeedbackStatus.KEPT ? 'kept' : 'removed',
        note: r.resolutionNote ?? null,
        at: (r.resolvedAt ?? r.updatedAt).toISOString(),
      }));
    const mine = rows.filter((r) => r.userId === userId);
    return {
      ...view,
      corrections,
      feedback: {
        helpful:
          mine.find((r) => r.kind === DebriefFeedbackKind.HELPFUL)?.helpful ??
          null,
        flags: mine
          .filter(
            (r) =>
              r.kind === DebriefFeedbackKind.FLAG &&
              r.status !== DebriefFeedbackStatus.WITHDRAWN,
          )
          .map((r) => ({
            id: r.id,
            section: r.section,
            status: r.status,
            canUndoUntil:
              r.status === DebriefFeedbackStatus.OPEN
                ? new Date(
                    new Date(r.updatedAt).getTime() + FLAG_UNDO_MS,
                  ).toISOString()
                : null,
          })),
      },
    };
  }

  // --- The Ally team's review queue --------------------------------------------------

  async queue() {
    const runs = await this.dataSource.query(
      `SELECT r.id, r."scenarioSessionId", r.status, r."skipReason", r.language,
              r."hasRiskCue", r."learnerDistress", r."evaluatorOverall",
              (r.workspace->'judge'->>'overall')::float AS "judgeOverall",
              r."checkFailures", r."evaluatorHardFails", r."createdAt", t.name AS "tenantName"
         FROM debrief_runs r
         LEFT JOIN tenants t ON t.id::text = r.tenant_id
        WHERE r.mode = 'live'
          AND r.status IN ('needs_person','below_bar','failed')
          AND NOT (r.workspace ? 'review')
        ORDER BY r."hasRiskCue" DESC, r."createdAt" ASC
        LIMIT 200`,
    );
    const flags = await this.dataSource.query(
      `SELECT f.id, f."runId", f."scenarioSessionId", f.section, f.reason, f.note, f.urgent,
              f."createdAt", r.cards, r.language, t.name AS "tenantName"
         FROM debrief_run_feedback f
         JOIN debrief_runs r ON r.id = f."runId"
         LEFT JOIN tenants t ON t.id::text = f.tenant_id
        WHERE f.kind = 'flag' AND f.status = 'open'
          AND f."updatedAt" < now() - make_interval(secs => $1)
        ORDER BY f.urgent DESC, f."createdAt" ASC
        LIMIT 200`,
      // Flags still inside the learner's undo window are not work yet.
      [Math.round(FLAG_UNDO_MS / 1000)],
    );
    return {
      runs,
      flags: flags.map(({ cards, ...f }: Record<string, any>) => ({
        ...f,
        cardText: sectionText(cards as DebriefCards, f.section),
      })),
    };
  }

  /** A person finishes a live debrief: publish the best draft as it is. */
  async publishRun(runId: string, userId: number, note?: string) {
    const run = await this.liveRun(runId);
    if (!run.cards)
      throw new ConflictException('This run has no draft to publish');
    if (
      ![
        DebriefRunStatus.NEEDS_PERSON,
        DebriefRunStatus.BELOW_BAR,
        DebriefRunStatus.FAILED,
      ].includes(run.status)
    ) {
      throw new ConflictException(`This run is ${run.status}`);
    }
    await this.review(run, userId, 'published', note, {
      status: DebriefRunStatus.PUBLISHED,
    });
    return { id: run.id, status: DebriefRunStatus.PUBLISHED };
  }

  /** A person sends the learner back to today's debrief for this session. */
  async fallbackRun(runId: string, userId: number, note?: string) {
    const run = await this.liveRun(runId);
    await this.review(run, userId, 'todays_debrief', note, {
      status: DebriefRunStatus.SKIPPED,
      skipReason: 'reviewer_fallback',
    });
    return { id: run.id, status: DebriefRunStatus.SKIPPED };
  }

  /** A below-the-bar debrief the learner already has: looked at, nothing to change. */
  async markReviewed(runId: string, userId: number, note?: string) {
    const run = await this.liveRun(runId);
    await this.review(run, userId, 'reviewed', note, {});
    return { id: run.id };
  }

  async resolveFlag(
    flagId: string,
    userId: number,
    outcome: 'kept' | 'removed',
    note?: string | null,
  ) {
    const row = await this.feedback.findOne({
      where: { id: flagId, kind: DebriefFeedbackKind.FLAG },
    });
    if (!row) throw new NotFoundException('Flag not found');
    if (row.status !== DebriefFeedbackStatus.OPEN) {
      throw new ConflictException(`This flag is already ${row.status}`);
    }
    const reason = note?.trim() ?? '';
    if (outcome === 'kept' && !reason) {
      throw new BadRequestException(
        'Say why the point stays; the learner reads it',
      );
    }
    row.status =
      outcome === 'kept'
        ? DebriefFeedbackStatus.KEPT
        : DebriefFeedbackStatus.REMOVED;
    row.resolvedBy = userId;
    row.resolvedAt = new Date();
    row.resolutionNote = reason ? reason.slice(0, 500) : null;
    await this.feedback.save(row);
    return { id: row.id, status: row.status };
  }

  private async liveRun(runId: string): Promise<DebriefRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.mode !== DebriefRunMode.LIVE)
      throw new NotFoundException('Live run not found');
    return run;
  }

  private async review(
    run: DebriefRun,
    userId: number,
    action: string,
    note: string | undefined,
    patch: Partial<DebriefRun>,
  ) {
    await this.runs.update(run.id, {
      ...patch,
      workspace: {
        ...run.workspace,
        review: {
          by: userId,
          at: new Date().toISOString(),
          action,
          note: note?.slice(0, 500) ?? null,
        },
      },
    } as any);
  }

  /** Counts the Improver reads: never the learners' notes. */
  async signals(windowDays: number) {
    const [h] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE helpful)::int AS yes,
              count(*) FILTER (WHERE NOT helpful)::int AS no
         FROM debrief_run_feedback
        WHERE kind = 'helpful' AND "createdAt" >= now() - make_interval(days => $1)`,
      [windowDays],
    );
    const flags = await this.dataSource.query(
      `SELECT regexp_replace(section, '\\[\\d+\\]', '') AS section, reason, status, count(*)::int AS n
         FROM debrief_run_feedback
        WHERE kind = 'flag' AND status <> 'withdrawn'
          AND "createdAt" >= now() - make_interval(days => $1)
        GROUP BY 1, 2, 3`,
      [windowDays],
    );
    const answered = Number(h?.yes ?? 0) + Number(h?.no ?? 0);
    return {
      helpful: {
        answered,
        yes: Number(h?.yes ?? 0),
        rate: answered
          ? Math.round((Number(h.yes) / answered) * 100) / 100
          : null,
      },
      flags,
    };
  }
}
