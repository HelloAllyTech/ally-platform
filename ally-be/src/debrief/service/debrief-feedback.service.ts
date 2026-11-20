import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
  DebriefFlagReason,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';
import { DebriefCards, cardsForReader } from '../util/debrief-cards.util';
import { checkTransition } from '../util/debrief-run-status.util';
import { readableCards } from '../util/debrief-competencies.util';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefSlackService } from './debrief-slack.service';
import { DebriefPublishService } from './debrief-publish.service';
import { LearnerDebriefView } from './debrief-agent.service';

/** A learner can take a flag back for this long after sending it (plan §7.6). */
export const FLAG_UNDO_MS = 10 * 60 * 1000;

/** What the learner sees on a card after the Ally team reviewed their flag. */
export interface DebriefCorrection {
  section: string;
  outcome: 'kept' | 'removed' | 'corrected';
  note: string | null;
  at: string;
}

/** The fields of a card a reviewer may rewrite; the quote is the learner's own words. */
export const CORRECTABLE_FIELDS = [
  'lead',
  'body',
  'why',
  'try_saying',
  'reason',
] as const;
export type CardCorrection = Partial<
  Record<(typeof CORRECTABLE_FIELDS)[number], string>
>;

/** The card object a section key names, or undefined. */
export function cardAt(
  cards: Record<string, any> | null | undefined,
  section: string,
): Record<string, any> | undefined {
  if (!cards) return undefined;
  const m = /^(what_worked|work_on_this)\[(\d+)\]$/.exec(section);
  if (m) return cards[m[1]]?.[Number(m[2])];
  return section === 'important_moment' || section === 'practise_next'
    ? cards[section]
    : undefined;
}

/** The card a section names, cut to the fields a reviewer may rewrite. */
export function correctableFields(
  cards: DebriefCards | null | undefined,
  section: string,
): CardCorrection | null {
  const card = cardAt(cards as Record<string, any>, section);
  if (!card) return null;
  const out: CardCorrection = {};
  for (const f of CORRECTABLE_FIELDS) {
    if (typeof card[f] === 'string') out[f] = card[f];
  }
  return Object.keys(out).length ? out : null;
}

/** The review-queue section for an Ask Ally item. */
export const ASK_ALLY_SECTION = 'ask_ally';

/**
 * What a supervisor reads on Roleplay Logs (v9 FR-26, Q47): the learner's
 * debrief as published, their flags with the outcome, their "Was this
 * helpful?" answer and their Ask Ally thread — all read-only.
 */
export interface SupervisorDebriefView {
  state: 'ready' | 'not_available';
  readOnly: true;
  cards?: Record<string, any> | null;
  language?: string | null;
  corrections?: DebriefCorrection[];
  flags?: Array<{
    section: string;
    reason: string | null;
    note: string | null;
    status: string;
    resolutionNote: string | null;
  }>;
  helpful?: boolean | null;
  thread?: Array<{ role: 'learner' | 'ally'; content: string; at: string }>;
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
    case 'practise_next': {
      if (!cards.practise_next) return null;
      // A course session: "Try the following:" is read after the reason.
      const tryNext = (cards.practise_next.try_next ?? []).filter(
        (t) => typeof t === 'string' && t.trim(),
      );
      return [
        cards.practise_next.skill ? `${cards.practise_next.skill}.` : '',
        cards.practise_next.reason,
        ...tryNext,
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'reflective_question':
      return cards.reflective_question ?? null;
    case 'progress_note':
      return cards.progress_note ?? null;
    case 'progress_card': {
      // "Your last {n} sessions": the progress agent's own learner lines,
      // already in the debrief's language; the focus first, as the card shows.
      const card = (cards as unknown as Record<string, any>).progress_card;
      if (!card || typeof card !== 'object') return null;
      const lines = [
        card.focus?.line,
        ...(Array.isArray(card.skills) ? card.skills : []).map(
          (s: { line?: unknown }) => s?.line,
        ),
      ].filter((l): l is string => typeof l === 'string' && !!l.trim());
      return lines.length ? lines.join(' ') : null;
    }
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
  private readonly logger = LoggerService.getInstance(
    DebriefFeedbackService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    @InjectRepository(DebriefFeedback)
    private readonly feedback: Repository<DebriefFeedback>,
    private readonly notifier?: DebriefNotifier,
    /** v9 FR-20: a debrief a person publishes or corrects is written where today's was. */
    @Optional() private readonly publisher?: DebriefPublishService,
    /** v2 K3: a learner in distress in Ask Ally goes to the safety contact on Slack. */
    @Optional() private readonly slack?: DebriefSlackService,
  ) {}

  private readonly flagListeners: Array<(flagId: string) => void> = [];

  /** Told of each new flag (V2_AUTONOMY F1: DebriefFlagAnswerService answers it). */
  onFlag(listener: (flagId: string) => void): void {
    this.flagListeners.push(listener);
  }

  /** The learner's own published live debrief, or a refusal. */
  /**
   * v9 FR-31: the learner opened the debrief — the ready cards were in the
   * foreground for at least 2 s. Recorded once, as `openedAt`; from then on
   * only a reviewer's correction (with its banner) changes what they read.
   */
  async markOpened(sessionId: string, userId: number) {
    const run = await this.ownLiveRun(sessionId, userId);
    if (run.workspace?.openedAt) {
      return { openedAt: run.workspace.openedAt as string };
    }
    const openedAt = new Date().toISOString();
    await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{openedAt}', to_jsonb($2::text))
        WHERE id = $1 AND NOT (coalesce(workspace, '{}'::jsonb) ? 'openedAt')`,
      [run.id, openedAt],
    );
    return { openedAt };
  }

  async ownLiveRun(sessionId: string, userId: number): Promise<DebriefRun> {
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

  /**
   * The learner showed distress in Ask Ally: an urgent item in the review
   * queue (v9 FR-23), at most one open per debrief. No message text is
   * copied; the reviewer opens the thread.
   */
  async raiseChatDistress(run: DebriefRun, userId: number, source: string) {
    // Posted once per debrief, whether or not a review item is already open.
    void this.slack?.chatDistress(run).catch(() => false);
    const open = await this.feedback.findOne({
      where: {
        runId: run.id,
        userId,
        kind: DebriefFeedbackKind.FLAG,
        section: ASK_ALLY_SECTION,
        status: DebriefFeedbackStatus.OPEN,
      },
    });
    if (open) return;
    await this.feedback.save(
      this.feedback.create({
        tenantId: run.tenantId ?? null,
        runId: run.id,
        scenarioSessionId: run.scenarioSessionId,
        userId,
        kind: DebriefFeedbackKind.FLAG,
        section: ASK_ALLY_SECTION,
        reason: DebriefFlagReason.SOMETHING_ELSE,
        note: `Learner distress in Ask Ally (${source}). Open the thread.`,
        urgent: true,
        status: DebriefFeedbackStatus.OPEN,
      }),
    );
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
    // V2_AUTONOMY F1: the Debrief agent answers it within a minute.
    for (const listener of this.flagListeners) {
      try {
        listener(saved.id);
      } catch {
        // An answer that cannot start is picked up by the sweep.
      }
    }
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
   * What the learner's most recent debrief for this roleplay asked of them:
   * the "What to strengthen" lines they could try saying, and the
   * "Try this in your next practice" nudge. Shown under Reminders on the
   * roleplay call screen so the points stay in mind on the next attempt.
   * Only the learner's own live debrief, read as they read it; points a
   * reviewer removed are left out; nothing when there is no debrief yet.
   */
  async latestPoints(
    scenarioId: number,
    userId: number,
  ): Promise<{
    runId: string | null;
    workOnThis: Array<{ lead: string; trySaying: string }>;
    practiseNext: { skill: string; reason: string } | null;
  }> {
    const none = { runId: null, workOnThis: [], practiseNext: null };
    const rows: Array<{
      id: string;
      cards: Record<string, any> | null;
      recipe_key: string | null;
    }> = await this.dataSource.query(
      `SELECT r.id, r.cards, r."recipeKey" AS recipe_key
           FROM debrief_runs r
           JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
          WHERE s."counselorId" = $1 AND s."scenarioId" = $2
            AND r.mode = 'live' AND r.status IN ('published','below_bar')
            AND r.cards IS NOT NULL
          ORDER BY COALESCE(s."endedAt", s."updatedAt") DESC
          LIMIT 1`,
      [userId, scenarioId],
    );
    const run = rows?.[0];
    if (!run?.cards) return none;
    const removed = new Set(
      (
        await this.feedback.find({
          where: { runId: run.id, status: DebriefFeedbackStatus.REMOVED },
        })
      ).map((r) => r.section),
    );
    const cards = cardsForReader(
      run.cards,
      run.recipe_key,
    ) as Partial<DebriefCards>;
    const workOnThis = (cards.work_on_this ?? [])
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !removed.has(`work_on_this[${i}]`) && c.lead)
      .map(({ c }) => ({ lead: c.lead, trySaying: c.try_saying ?? '' }));
    const next = cards.practise_next;
    return {
      runId: run.id,
      workOnThis,
      practiseNext:
        next && !removed.has('practise_next') && next.skill
          ? { skill: next.skill, reason: next.reason ?? '' }
          : null,
    };
  }

  /**
   * The learner's view with their own feedback and the review outcomes. Cards
   * stay as stored: the apps hide a removed card by its stored index (the
   * same index its flag names) and show the outcome, so nothing shifts.
   */
  async decorate(view: LearnerDebriefView, userId: number) {
    if (view.state !== 'ready' || !view.runId || !view.cards) return view;
    // The Ask Ally distress item is the team's (created by the reply check,
    // decided with a note to colleagues): never part of the learner's view.
    const rows = (
      await this.feedback.find({ where: { runId: view.runId } })
    ).filter((r) => r.section !== ASK_ALLY_SECTION);
    const corrections: DebriefCorrection[] = rows
      .filter(
        (r) =>
          r.status === DebriefFeedbackStatus.KEPT ||
          r.status === DebriefFeedbackStatus.REMOVED ||
          r.status === DebriefFeedbackStatus.CORRECTED,
      )
      .map((r) => ({
        section: r.section!,
        outcome:
          r.status === DebriefFeedbackStatus.KEPT
            ? 'kept'
            : r.status === DebriefFeedbackStatus.CORRECTED
              ? 'corrected'
              : 'removed',
        note: r.resolutionNote ?? null,
        at: (r.resolvedAt ?? r.updatedAt).toISOString(),
      }));
    corrections.push(...(await this.runCorrections(view.runId)));
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
            // Escalation is the team's business; the learner still sees "under review".
            status:
              r.status === DebriefFeedbackStatus.ESCALATED
                ? DebriefFeedbackStatus.OPEN
                : r.status,
            // V2_AUTONOMY F1: what the Debrief agent did, and its reply.
            answer: r.answer
              ? {
                  action: r.answer.action,
                  reply: r.answer.reply,
                  at: r.answer.at,
                }
              : null,
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

  /**
   * The read-only view for a supervisor: an organisation admin for their own
   * organisation's sessions, or a platform admin for any. A session with no
   * published Debrief-agent debrief is `not_available` (today's note stays).
   */
  async supervisorView(
    sessionId: string,
    viewer: { tenantId: string | null; platformAdmin: boolean },
  ): Promise<SupervisorDebriefView> {
    const none: SupervisorDebriefView = {
      state: 'not_available',
      readOnly: true,
    };
    const [s] = await this.dataSource.query(
      `SELECT tenant_id, "counselorId" AS counselor_id FROM scenario_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!s) return none;
    if (!viewer.platformAdmin && s.tenant_id !== viewer.tenantId) {
      throw new ForbiddenException('Not a session in your organisation');
    }
    const run = await this.runs.findOne({
      where: { scenarioSessionId: sessionId, mode: DebriefRunMode.LIVE },
    });
    if (
      !run?.cards ||
      ![DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      )
    ) {
      return none;
    }
    const learnerId = Number(s.counselor_id);
    const rows = await this.feedback.find({ where: { runId: run.id } });
    const learner = rows.filter((r) => r.userId === learnerId);
    const thread: Array<{
      senderId: number;
      content: string;
      createdAt: Date;
    }> = await this.dataSource.query(
      `SELECT m."senderId", m.content, m."createdAt"
           FROM scenario_session_chat_messages m
           JOIN scenario_session_chats c ON c.id = m."chatId"
          WHERE c."scenarioSessionId" = $1 AND c."userId" = $2
          ORDER BY m."createdAt" ASC`,
      [sessionId, learnerId],
    );
    const decorated = (await this.decorate(
      {
        state: 'ready',
        runId: run.id,
        cards: run.cards,
        language: run.language,
      },
      learnerId,
    )) as { corrections?: DebriefCorrection[] };
    return {
      state: 'ready',
      readOnly: true,
      // The supervisor reads what the learner reads: no custom codes.
      cards: await readableCards(
        this.dataSource,
        cardsForReader(run.cards, run.recipeKey),
      ),
      language: run.language,
      corrections: decorated.corrections ?? [],
      flags: learner
        .filter(
          (r) =>
            r.kind === DebriefFeedbackKind.FLAG &&
            r.status !== DebriefFeedbackStatus.WITHDRAWN,
        )
        .map((r) => ({
          section: r.section!,
          reason: r.reason ?? null,
          note: r.note ?? null,
          status: r.status,
          resolutionNote: r.resolutionNote ?? null,
        })),
      helpful:
        learner.find((r) => r.kind === DebriefFeedbackKind.HELPFUL)?.helpful ??
        null,
      thread: thread.map((m) => ({
        role: Number(m.senderId) === -1 ? 'ally' : 'learner',
        content: m.content,
        at: new Date(m.createdAt).toISOString(),
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
    // A below-the-bar run was already readable and written; one a person
    // finishes is written now, with its memory update and ready event.
    await this.publisher?.applyToSession(
      { ...run, status: DebriefRunStatus.PUBLISHED } as DebriefRun,
      { announce: run.status !== DebriefRunStatus.BELOW_BAR },
    );
    // A learner waiting on "on its way" hears that it is ready (FR-28).
    if (run.status === DebriefRunStatus.NEEDS_PERSON) {
      await this.notifier?.ready({
        ...run,
        status: DebriefRunStatus.PUBLISHED,
      });
    }
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
    outcome: 'kept' | 'removed' | 'corrected',
    note?: string | null,
    correction?: CardCorrection | null,
  ) {
    const row = await this.feedback.findOne({
      where: { id: flagId, kind: DebriefFeedbackKind.FLAG },
    });
    if (!row) throw new NotFoundException('Flag not found');
    if (
      ![DebriefFeedbackStatus.OPEN, DebriefFeedbackStatus.ESCALATED].includes(
        row.status,
      )
    ) {
      throw new ConflictException(`This flag is already ${row.status}`);
    }
    const reason = note?.trim() ?? '';
    if ((outcome === 'kept' || outcome === 'corrected') && !reason) {
      throw new BadRequestException(
        outcome === 'kept'
          ? 'Say why the point stays; the learner reads it'
          : 'Say what changed; the learner reads it',
      );
    }
    let version: number | undefined;
    if (outcome === 'corrected') {
      ({ version } = await this.correctCard(
        row.runId,
        row.section!,
        correction ?? {},
        userId,
        { note: reason, flagId: row.id },
      ));
    }
    row.status =
      outcome === 'kept'
        ? DebriefFeedbackStatus.KEPT
        : outcome === 'corrected'
          ? DebriefFeedbackStatus.CORRECTED
          : DebriefFeedbackStatus.REMOVED;
    row.resolvedBy = userId;
    row.resolvedAt = new Date();
    row.resolutionNote = reason ? reason.slice(0, 500) : null;
    await this.feedback.save(row);
    // The learner is told their debrief was reviewed (FR-31). An Ask Ally
    // distress item is about the learner, not a card: nothing to announce.
    if (row.section !== ASK_ALLY_SECTION) {
      const run = await this.runs.findOne({ where: { id: row.runId } });
      if (run) await this.notifier?.reviewed(run);
    }
    return {
      id: row.id,
      status: row.status,
      ...(version ? { version } : {}),
    };
  }

  /**
   * v9 FR-31 "Correct": a reviewer rewrites a card's words. The cards become
   * a new version; the one before is kept in the workspace, so nothing a
   * learner was shown is lost. The quote never changes: it is the learner's
   * own words. `note` is the "what changed" line the learner reads; `flagId`
   * ties the version to the flag it answers (its note is the flag's).
   */
  private async correctCard(
    runId: string,
    section: string,
    correction: CardCorrection,
    userId: number | null,
    meta: {
      note?: string | null;
      flagId?: string | null;
      /** V2_AUTONOMY F1: the Debrief agent rewrote it, answering a flag. */
      byAgent?: boolean;
    } = {},
  ): Promise<{ version: number }> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run?.cards) throw new NotFoundException('This debrief has no cards');
    const cards = JSON.parse(JSON.stringify(run.cards)) as Record<string, any>;
    const card = cardAt(cards, section);
    if (!card) throw new BadRequestException('That card cannot be corrected');
    if (
      'quote' in (correction as Record<string, unknown>) &&
      (correction as Record<string, unknown>).quote !== card.quote
    ) {
      throw new BadRequestException(
        "The quote is the learner's own words and cannot be changed",
      );
    }
    const changes = Object.entries(correction).filter(
      ([field, text]) =>
        (CORRECTABLE_FIELDS as readonly string[]).includes(field) &&
        typeof text === 'string' &&
        text.trim() &&
        field in card,
    );
    if (!changes.length) {
      throw new BadRequestException('Change at least one line of the card');
    }
    for (const [field, text] of changes) card[field] = (text as string).trim();
    const previous = (run.workspace?.versions as unknown[]) ?? [];
    // Version 1 is what the run published; each correction adds one.
    const version = previous.length + 2;
    const versions = [
      ...previous,
      {
        version,
        at: new Date().toISOString(),
        by: userId,
        section,
        fields: changes.map(([f]) => f),
        note: meta.note?.trim() ? meta.note.trim().slice(0, 500) : null,
        flagId: meta.flagId ?? null,
        ...(meta.byAgent ? { byAgent: true } : {}),
        before: run.cards,
      },
    ];
    await this.runs.update(run.id, {
      cards,
      workspace: { ...(run.workspace ?? {}), versions },
    } as Partial<DebriefRun>);
    // The session's note follows the correction (v9 FR-20, FR-31).
    await this.publisher?.applyToSession(
      { ...run, cards } as unknown as DebriefRun,
      { announce: false },
    );
    return { version };
  }

  /**
   * V2_AUTONOMY F1: the Debrief agent's answer to a learner's flag, applied
   * the way a person's decision is (resolveFlag): the card kept, corrected (a
   * new card version, the quote locked) or removed, the reply as the note the
   * learner reads, and the learner told. Stored on the flag as `answer`. An
   * important-moment flag is never removed here: that answer is refused.
   * Returns null when the flag was decided or withdrawn meanwhile.
   */
  async applyAgentAnswer(
    flagId: string,
    a: {
      action: 'keep' | 'correct' | 'remove';
      reply: string;
      correction?: CardCorrection | null;
      model?: string | null;
      costUsd?: number | null;
    },
  ): Promise<DebriefFeedback | null> {
    const row = await this.feedback.findOne({
      where: { id: flagId, kind: DebriefFeedbackKind.FLAG },
    });
    if (
      !row ||
      row.answer ||
      ![DebriefFeedbackStatus.OPEN, DebriefFeedbackStatus.ESCALATED].includes(
        row.status,
      )
    ) {
      return null;
    }
    const reply = (a.reply ?? '').trim().slice(0, 500);
    if (!reply) throw new BadRequestException('The answer has no reply');
    const important =
      row.section === 'important_moment' ||
      (row.section ?? '').startsWith('important_moment.');
    if (a.action === 'remove' && important) {
      throw new BadRequestException(
        'An important-moment card is never removed automatically',
      );
    }
    if (a.action === 'correct') {
      await this.correctCard(
        row.runId,
        row.section!,
        a.correction ?? {},
        null,
        {
          note: reply,
          flagId: row.id,
          byAgent: true,
        },
      );
    }
    const action =
      a.action === 'keep'
        ? 'kept'
        : a.action === 'correct'
          ? 'corrected'
          : 'removed';
    row.status =
      action === 'kept'
        ? DebriefFeedbackStatus.KEPT
        : action === 'corrected'
          ? DebriefFeedbackStatus.CORRECTED
          : DebriefFeedbackStatus.REMOVED;
    row.resolvedBy = null;
    row.resolvedAt = new Date();
    row.resolutionNote = reply;
    row.answer = {
      action,
      reply,
      at: row.resolvedAt.toISOString(),
      model: a.model ?? null,
      costUsd: a.costUsd ?? null,
    };
    const saved = await this.feedback.save(row);
    const run = await this.runs.findOne({ where: { id: row.runId } });
    if (run) await this.notifier?.reviewed(run);
    return saved;
  }

  /**
   * Correct in place without a flag (PRD §6.7): a published debrief the judge
   * scored below the bar, or a held one, rewritten by the Ally team. The quote
   * stays locked, the cards become a new version, and the learner reads the
   * "what changed" note on the card and is told their debrief was updated.
   */
  async correctRun(
    runId: string,
    section: string,
    correction: CardCorrection,
    note: string | null | undefined,
    userId: number,
  ): Promise<{ id: string; version: number; section: string }> {
    const run = await this.liveRun(runId);
    if (!note?.trim()) {
      throw new BadRequestException('Say what changed; the learner reads it');
    }
    if (
      ![DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR].includes(
        run.status,
      )
    ) {
      throw new ConflictException(
        `This debrief is ${run.status}; publish it before correcting a card`,
      );
    }
    const { version } = await this.correctCard(
      run.id,
      section,
      correction,
      userId,
      { note },
    );
    const fresh = await this.runs.findOne({ where: { id: run.id } });
    if (fresh && !fresh.workspace?.review) {
      await this.review(fresh, userId, 'corrected', note ?? undefined, {});
    }
    if (fresh) await this.notifier?.reviewed(fresh);
    return { id: run.id, version, section };
  }

  /** Corrections made without a flag, as the learner reads them. */
  async runCorrections(runId: string): Promise<DebriefCorrection[]> {
    const run = await this.runs.findOne({ where: { id: runId } });
    const versions = (run?.workspace?.versions ?? []) as Array<{
      at: string;
      section: string;
      note?: string | null;
      flagId?: string | null;
    }>;
    return versions
      .filter((v) => !v.flagId && v.note)
      .map((v) => ({
        section: v.section,
        outcome: 'corrected' as const,
        note: v.note ?? null,
        at: v.at,
      }));
  }

  /**
   * "Escalate to clinical advisor" (v9 FR-38): the flag stays in the queue,
   * marked, and the clinical advisor is told. They resolve it as anyone would.
   */
  async escalateFlag(flagId: string, userId: number, note?: string | null) {
    const row = await this.feedback.findOne({
      where: { id: flagId, kind: DebriefFeedbackKind.FLAG },
    });
    if (!row) throw new NotFoundException('Flag not found');
    if (row.status !== DebriefFeedbackStatus.OPEN) {
      throw new ConflictException(`This flag is already ${row.status}`);
    }
    row.status = DebriefFeedbackStatus.ESCALATED;
    row.urgent = true;
    await this.feedback.save(row);
    await this.notifier?.escalated({
      what: 'flag',
      scenarioSessionId: row.scenarioSessionId,
      note: note?.trim() || null,
      by: userId,
    });
    return { id: row.id, status: row.status };
  }

  /** Escalate a debrief waiting in Review (needs a person, below the bar, distress). */
  async escalateRun(runId: string, userId: number, note?: string | null) {
    const run = await this.liveRun(runId);
    await this.runs.update(run.id, {
      workspace: {
        ...(run.workspace ?? {}),
        escalation: {
          by: userId,
          at: new Date().toISOString(),
          note: note?.trim() || null,
        },
      },
    } as Partial<DebriefRun>);
    await this.notifier?.escalated({
      what: 'run',
      scenarioSessionId: run.scenarioSessionId,
      note: note?.trim() || null,
      by: userId,
    });
    return { id: run.id, escalated: true };
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
    if (patch.status) {
      checkTransition(
        run.status,
        patch.status,
        this.logger,
        `a person (${action})`,
      );
    }
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

  /**
   * V2_AUTONOMY F2–F3: what the PM agent reads about flags answered, cards
   * changed and Ask Ally replies replaced — counts, check codes and run ids,
   * never a learner's note or anyone's words. A person's "Change it" (a card
   * version not written by the agent) counts as a person correction.
   */
  async pmEvidence(windowDays: number) {
    const answers = await this.dataSource.query(
      `SELECT regexp_replace(section, '\\[\\d+\\]', '') AS section, reason,
              answer->>'action' AS action, count(*)::int AS n,
              count(*) FILTER (WHERE (answer->>'at')::timestamptz - "createdAt" <= interval '60 seconds')::int AS within_a_minute,
              (array_agg("runId"::text ORDER BY "createdAt" DESC))[1:5] AS run_ids
         FROM debrief_run_feedback
        WHERE kind = 'flag' AND answer IS NOT NULL
          AND "createdAt" >= now() - make_interval(days => $1)
        GROUP BY 1, 2, 3`,
      [windowDays],
    );
    const [unanswered] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM debrief_run_feedback
        WHERE kind = 'flag' AND answer IS NULL AND status IN ('open','escalated')
          AND section <> $2 AND "createdAt" >= now() - make_interval(days => $1)`,
      [windowDays, ASK_ALLY_SECTION],
    );
    const corrections = await this.dataSource.query(
      `SELECT regexp_replace(v->>'section', '\\[\\d+\\]', '') AS section,
              CASE WHEN (v->>'byAgent')::boolean THEN 'debrief_agent' ELSE 'person' END AS by,
              count(*)::int AS n,
              (array_agg(r.id::text))[1:5] AS run_ids
         FROM debrief_runs r,
              jsonb_array_elements(coalesce(r.workspace->'versions', '[]'::jsonb)) v
        WHERE (v->>'at')::timestamptz >= now() - make_interval(days => $1)
        GROUP BY 1, 2`,
      [windowDays],
    );
    const replaced = await this.dataSource.query(
      `SELECT f AS check_code, count(*)::int AS n, (array_agg(DISTINCT r.id::text))[1:5] AS run_ids
         FROM debrief_runs r,
              jsonb_array_elements(coalesce(r.workspace->'replacedReplies', '[]'::jsonb)) e,
              jsonb_array_elements_text(coalesce(e->'fails', '[]'::jsonb)) f
        WHERE (e->>'at')::timestamptz >= now() - make_interval(days => $1)
        GROUP BY 1`,
      [windowDays],
    );
    return {
      flag_answers: answers,
      flags_unanswered: Number(unanswered?.n ?? 0),
      card_changes: corrections,
      ask_ally_replaced: replaced,
    };
  }

  /** Counts the PM agent reads: never the learners' notes. */
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
    // The learners' own words (Gopi, 2026-11-16: the PM agent reads them, not
    // only counts). What a learner flags may be wrong, so each flag comes with
    // what Ally decided and why. Capped and trimmed; read only by the PM agent.
    const read = async <T>(sql: string): Promise<T[]> => {
      try {
        return await this.dataSource.query(sql, [windowDays]);
      } catch {
        return [];
      }
    };
    const flagWords = await read<Record<string, any>>(
      `SELECT regexp_replace(section, '\\[\\d+\\]', '') AS section, reason,
              left(note, 300) AS note, answer->>'action' AS ally_action,
              left(answer->>'reply', 300) AS ally_reason, status
         FROM debrief_run_feedback
        WHERE kind = 'flag' AND status <> 'withdrawn'
          AND "createdAt" >= now() - make_interval(days => $1)
        ORDER BY "createdAt" DESC LIMIT 40`,
    );
    const notHelpful = await read<Record<string, any>>(
      `SELECT left(note, 300) AS note
         FROM debrief_run_feedback
        WHERE kind = 'helpful' AND helpful = false AND coalesce(note, '') <> ''
          AND "createdAt" >= now() - make_interval(days => $1)
        ORDER BY "createdAt" DESC LIMIT 30`,
    );
    const askAlly = await read<Record<string, any>>(
      `SELECT left(m.content, 200) AS question
         FROM scenario_session_chat_messages m
         JOIN scenario_session_chats c ON c.id = m."chatId"
         JOIN debrief_runs r ON r."scenarioSessionId" = c."scenarioSessionId" AND r.mode = 'live'
        WHERE m."senderId" = c."userId"
          AND m."createdAt" >= now() - make_interval(days => $1)
        ORDER BY m."createdAt" DESC LIMIT 40`,
    );
    return {
      helpful: {
        answered,
        yes: Number(h?.yes ?? 0),
        rate: answered
          ? Math.round((Number(h.yes) / answered) * 100) / 100
          : null,
      },
      flags,
      /** Each flag with the learner's note and what Ally decided (kept / corrected / removed) and why. */
      flag_words: flagWords,
      /** What learners wrote when a debrief was not helpful. */
      not_helpful_comments: notHelpful.map((r) => r.note),
      /** Learners' recent Ask Ally questions: summarise what they keep asking. */
      ask_ally_questions: askAlly.map((r) => r.question),
    };
  }
}
