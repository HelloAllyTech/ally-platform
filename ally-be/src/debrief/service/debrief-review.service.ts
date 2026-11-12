import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  DEBRIEF_HARD_FAIL_CODES,
  DebriefHardFailCode,
} from '../../analytics/util/debrief-calibration.util';
import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { DebriefReview } from '../entity/debrief-review.entity';
import { DebriefReviewComment } from '../entity/debrief-review-comment.entity';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
} from '../enum/debrief-run.enum';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
  DebriefCommentTag,
  DebriefReviewVerdict,
} from '../enum/debrief-review.enum';
import { isTranscriptGap } from '../util/debrief-cards.util';
import {
  COMMENT_BODY_MAX,
  CommentAnchorInput,
  CommentRow,
  DISAGREEMENT_POINTS,
  GatewayComment,
  isCommentTag,
  REVIEW_SOURCES,
  ReviewSource,
  SAMPLE_MODULO,
  toGatewayComments,
  validateAnchor,
} from '../util/debrief-review.util';
import { DebriefContextRepository } from './debrief-context.repository';

/** The PM agent's ideas live in agent_lessons under this key. */
const IDEA_AGENT_KEY = 'debrief';

/** Runs the review screen can open: a debrief with cards, written for a real session. */
const REVIEWABLE = `r.mode IN ('live','shadow') AND r.cards IS NOT NULL
  AND r.status IN ('published','below_bar','needs_person')`;

export interface QueueFilters {
  tenantId?: string;
  language?: string;
  sessionType?: string;
  source?: ReviewSource;
  /** Include runs the caller already gave a verdict on. */
  includeReviewed?: boolean;
}

export interface NewComment extends CommentAnchorInput {
  body: string;
  tag?: DebriefCommentTag | null;
  parentId?: string | null;
}

export interface ReviewTranscriptTurn {
  turnIndex: number;
  speaker: 'client' | 'learner';
  text: string;
  gap: boolean;
  riskCue: { category: string; learnerResponse: string } | null;
}

const trimBody = (body: unknown): string => {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new BadRequestException('Write a comment first.');
  if (text.length > COMMENT_BODY_MAX) {
    throw new BadRequestException(
      `Keep a comment under ${COMMENT_BODY_MAX} characters.`,
    );
  }
  return text;
};

/**
 * Expert review (debrief orchestrator spec Part B): clinical experts read a
 * run's transcript beside the cards the learner read, comment on exact lines
 * and give a verdict. Comments are the PM agent's main signal (read through
 * the gateway, `commentsForAgent`); verdicts calibrate the judge (read by
 * `DebriefCalibrationService.getAgreement`). Learners never see any of it.
 *
 * Reviewers work across organisations, so these reads are deliberately
 * platform-wide: every route is behind the expert permission and the Debrief
 * Console's toggle, and every view is audited.
 */
@Injectable()
export class DebriefReviewService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    @InjectRepository(DebriefReview)
    private readonly reviews: Repository<DebriefReview>,
    @InjectRepository(DebriefReviewComment)
    private readonly comments: Repository<DebriefReviewComment>,
    @InjectRepository(DebriefFeedback)
    private readonly feedback: Repository<DebriefFeedback>,
    private readonly context: DebriefContextRepository,
  ) {}

  // --- Queue --------------------------------------------------------------------------

  /**
   * Runs worth an expert's eye, each with why it is here. The judge's score
   * is withheld until the caller has given their own verdict (spec Q3), so
   * the queue never anchors the review.
   */
  async queue(reviewerId: number, f: QueueFilters = {}) {
    const passScore = DEBRIEF_SEED_BUNDLE.settings.passScore;
    const judge = `(r.workspace->'judge'->>'overall')::float`;
    const evaluator = `r."evaluatorOverall"::float`;
    const conditions = {
      risk_cue: `r."hasRiskCue"`,
      below_bar: `(r.status IN ('below_bar','needs_person') OR ${judge} < $2
        OR jsonb_array_length(coalesce(r.workspace->'judge'->'hardFails','[]'::jsonb)) > 0)`,
      learner_flag: `EXISTS (SELECT 1 FROM debrief_run_feedback f
        WHERE f."runId" = r.id AND f.kind = 'flag' AND f.status <> 'withdrawn')`,
      disagreement: `(${judge} IS NOT NULL AND ${evaluator} IS NOT NULL AND (
        abs(${judge} - ${evaluator}) >= $3 OR ((${judge} >= $2) <> (${evaluator} >= $2))))`,
      sample: `(abs(hashtext(r.id::text)) % $4) = 0`,
    } satisfies Record<ReviewSource, string>;
    const params: unknown[] = [
      reviewerId,
      passScore,
      DISAGREEMENT_POINTS,
      SAMPLE_MODULO,
    ];
    const where = [REVIEWABLE];
    const sources = f.source ? [f.source] : [...REVIEW_SOURCES];
    where.push(`(${sources.map((s) => conditions[s]).join(' OR ')})`);
    if (f.tenantId) {
      params.push(f.tenantId);
      where.push(`r.tenant_id = $${params.length}`);
    }
    if (f.language) {
      params.push(f.language);
      where.push(`r.language = $${params.length}`);
    }
    if (f.sessionType) {
      params.push(f.sessionType);
      where.push(`r."recipeKey" = $${params.length}`);
    }
    if (!f.includeReviewed) {
      where.push(`mine.id IS NULL`);
    }
    // You do not review a debrief of your own practice.
    where.push(`s."counselorId" IS DISTINCT FROM $1`);
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r.id, r."scenarioSessionId", r.status, r.mode, r.language, r."recipeKey",
              r."createdAt", r.tenant_id AS "tenantId", t.name AS "tenantName",
              ${conditions.risk_cue} AS risk_cue,
              ${conditions.below_bar} AS below_bar,
              ${conditions.learner_flag} AS learner_flag,
              ${conditions.disagreement} AS disagreement,
              ${conditions.sample} AS sample,
              ${judge} AS "judgeOverall",
              mine.verdict AS "myVerdict",
              (SELECT count(*)::int FROM debrief_review_comments c WHERE c."runId" = r.id) AS "commentCount",
              (SELECT count(*)::int FROM debrief_reviews v WHERE v."runId" = r.id) AS "reviewCount"
         FROM debrief_runs r
         JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
         LEFT JOIN tenants t ON t.id::text = r.tenant_id
         LEFT JOIN debrief_reviews mine ON mine."runId" = r.id AND mine."reviewerId" = $1
        WHERE ${where.join(' AND ')}
        ORDER BY r."hasRiskCue" DESC, r."createdAt" DESC
        LIMIT 100`,
      params,
    );
    return {
      items: rows.map((r) => ({
        runId: r.id,
        sessionId: r.scenarioSessionId,
        status: r.status,
        mode: r.mode,
        language: r.language ?? null,
        sessionType: r.recipeKey ?? null,
        tenantId: r.tenantId ?? null,
        tenantName: r.tenantName ?? null,
        createdAt: new Date(r.createdAt).toISOString(),
        reasons: REVIEW_SOURCES.filter((s) => r[s] === true),
        commentCount: Number(r.commentCount ?? 0),
        reviewCount: Number(r.reviewCount ?? 0),
        myVerdict: (r.myVerdict as DebriefReviewVerdict | null) ?? null,
        judgeOverall:
          r.myVerdict && r.judgeOverall != null ? Number(r.judgeOverall) : null,
      })),
      filters: await this.queueFilterOptions(),
    };
  }

  /** The organisations, languages and session types the queue's filters offer. */
  private async queueFilterOptions() {
    const tenants: Array<{ id: string; name: string | null }> =
      await this.dataSource.query(
        `SELECT DISTINCT r.tenant_id AS id, t.name
           FROM debrief_runs r LEFT JOIN tenants t ON t.id::text = r.tenant_id
          WHERE ${REVIEWABLE} AND r.tenant_id IS NOT NULL
          ORDER BY t.name NULLS LAST LIMIT 200`,
      );
    const languages: Array<{ v: string }> = await this.dataSource.query(
      `SELECT DISTINCT r.language AS v FROM debrief_runs r
        WHERE ${REVIEWABLE} AND r.language IS NOT NULL ORDER BY 1`,
    );
    const types: Array<{ v: string }> = await this.dataSource.query(
      `SELECT DISTINCT r."recipeKey" AS v FROM debrief_runs r
        WHERE ${REVIEWABLE} AND r."recipeKey" IS NOT NULL ORDER BY 1`,
    );
    return {
      tenants: tenants.map((t) => ({ id: t.id, name: t.name ?? t.id })),
      languages: languages.map((l) => l.v),
      sessionTypes: types.map((t) => t.v),
    };
  }

  // --- Review screen ------------------------------------------------------------------

  private async reviewableRun(runId: string, reviewerId: number) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || !run.cards || run.mode === 'replay') {
      throw new NotFoundException('This debrief cannot be reviewed.');
    }
    const [s] = await this.dataSource.query(
      `SELECT "counselorId" AS counselor_id FROM scenario_sessions WHERE id = $1`,
      [run.scenarioSessionId],
    );
    if (s && Number(s.counselor_id) === reviewerId) {
      throw new ForbiddenException(
        'You cannot review a debrief of your own practice.',
      );
    }
    return run;
  }

  /**
   * The transcript as the review screen shows it: numbered, gaps and risk
   * cues marked. Not redacted: reviewers and the clinical advisor need the
   * real context (console redesign decision, 2026-11-12; the redaction rule
   * belonged to the dropped outside-expert calibration set).
   */
  async reviewTranscript(run: DebriefRun): Promise<ReviewTranscriptTurn[]> {
    const turns = await this.context.transcript(run.scenarioSessionId);
    const cues = new Map<
      number,
      { category: string; learnerResponse: string }
    >();
    for (const c of (run.workspace?.safety?.risk_cues ?? []) as Array<{
      turn_index: number;
      category?: string;
      learner_response?: string;
    }>) {
      cues.set(Number(c.turn_index), {
        category: String(c.category ?? ''),
        learnerResponse: String(c.learner_response ?? ''),
      });
    }
    return turns.map((t) => ({
      turnIndex: t.turn_index,
      speaker: t.role === 'client' ? 'client' : 'learner',
      text: t.text,
      gap: isTranscriptGap(t.text),
      riskCue: cues.get(t.turn_index) ?? null,
    }));
  }

  /**
   * Everything the review screen draws for one run: the transcript, the cards
   * the learner read (with any correction the Ally team made), the learner's
   * flags, the comments with the idea each fed, and the caller's verdict. The
   * judge's and the Evaluator's readings, and other experts' verdicts, appear
   * only once the caller has given theirs.
   */
  async detail(runId: string, reviewerId: number) {
    const run = await this.reviewableRun(runId, reviewerId);
    const [transcript, mine, others, flags, comments, meta] = await Promise.all(
      [
        this.reviewTranscript(run),
        this.reviews.findOne({ where: { runId, reviewerId } }),
        this.reviews.find({ where: { runId } }),
        this.feedback.find({
          where: { runId, kind: DebriefFeedbackKind.FLAG },
          order: { createdAt: 'ASC' },
        }),
        this.commentsForRun(runId, reviewerId),
        this.dataSource.query(
          `SELECT t.name AS "tenantName" FROM tenants t WHERE t.id::text = $1`,
          [run.tenantId ?? ''],
        ),
      ],
    );
    const judge = run.workspace?.judge as
      | {
          overall: number | null;
          hardFails: Array<{ code: string; evidence: string }>;
          dimensions: Array<{ dimension: string; score: number }>;
        }
      | undefined;
    const revealed = !!mine;
    return {
      run: {
        id: run.id,
        sessionId: run.scenarioSessionId,
        status: run.status,
        mode: run.mode,
        language: run.language ?? null,
        sessionType: run.recipeKey ?? null,
        tenantName: meta?.[0]?.tenantName ?? null,
        createdAt: run.createdAt.toISOString(),
        hasRiskCue: run.hasRiskCue,
        learnerDistress: run.learnerDistress,
        releaseVersion: run.releaseVersion ?? null,
      },
      transcript,
      cards: run.cards,
      corrections: flags
        .filter((r) =>
          [
            DebriefFeedbackStatus.KEPT,
            DebriefFeedbackStatus.REMOVED,
            DebriefFeedbackStatus.CORRECTED,
          ].includes(r.status),
        )
        .map((r) => ({
          section: r.section,
          outcome: r.status,
          note: r.resolutionNote ?? null,
        })),
      flags: flags
        .filter((r) => r.status !== DebriefFeedbackStatus.WITHDRAWN)
        .map((r) => ({
          id: r.id,
          section: r.section ?? null,
          reason: r.reason ?? null,
          note: r.note ?? null,
          status: r.status,
          resolutionNote: r.resolutionNote ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      comments,
      myReview: mine
        ? {
            verdict: mine.verdict,
            hardFails: mine.hardFails ?? [],
            updatedAt: mine.updatedAt.toISOString(),
          }
        : null,
      otherReviews: {
        count: others.filter((o) => o.reviewerId !== reviewerId).length,
        verdicts: revealed
          ? others
              .filter((o) => o.reviewerId !== reviewerId)
              .map((o) => ({
                verdict: o.verdict,
                hardFails: o.hardFails ?? [],
              }))
          : null,
      },
      judge:
        revealed && judge
          ? {
              overall: judge.overall ?? null,
              hardFails: (judge.hardFails ?? []).map((h) => h.code),
            }
          : null,
      evaluator: revealed
        ? {
            overall:
              run.evaluatorOverall != null
                ? Number(run.evaluatorOverall)
                : null,
            hardFails: (run.evaluatorHardFails ?? []).map((h) => h.code),
          }
        : null,
      hardFailCodes: [...DEBRIEF_HARD_FAIL_CODES],
    };
  }

  /** A run's comments, oldest first, each with the idea it fed and whether it is the caller's. */
  async commentsForRun(runId: string, reviewerId: number) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT c.*, u.name AS "reviewerName",
              l.status AS "ideaStatus", l.text AS "ideaTitle",
              rep."runId" AS "repeatOfRunId", rep.body AS "repeatOfBody"
         FROM debrief_review_comments c
         LEFT JOIN users u ON u.id = c."reviewerId"
         LEFT JOIN agent_lessons l ON l.id = c."ideaId"
         LEFT JOIN debrief_review_comments rep ON rep.id = c."repeatOfId"
        WHERE c."runId" = $1
        ORDER BY c."createdAt" ASC`,
      [runId],
    );
    return rows.map((c) => this.toView(c, reviewerId));
  }

  private toView(c: Record<string, any>, reviewerId: number) {
    return {
      id: c.id,
      runId: c.runId,
      parentId: c.parentId ?? null,
      anchorKind: c.anchorKind,
      turnIndex: c.turnIndex ?? null,
      section: c.section ?? null,
      spanStart: c.spanStart ?? null,
      spanEnd: c.spanEnd ?? null,
      quotedText: c.quotedText ?? null,
      body: c.body,
      tag: c.tag ?? null,
      status: c.status,
      reviewer: { id: Number(c.reviewerId), name: c.reviewerName ?? null },
      mine: Number(c.reviewerId) === reviewerId,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
      resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : null,
      idea: c.ideaId
        ? {
            id: c.ideaId,
            title: c.ideaTitle ?? null,
            status: c.ideaStatus ?? null,
          }
        : null,
      repeatOf: c.repeatOfId
        ? {
            id: c.repeatOfId,
            runId: c.repeatOfRunId ?? null,
            body: c.repeatOfBody ?? null,
          }
        : null,
    };
  }

  private async viewOne(id: string, reviewerId: number) {
    const [row] = await this.dataSource.query(
      `SELECT c.*, u.name AS "reviewerName",
              l.status AS "ideaStatus", l.text AS "ideaTitle",
              rep."runId" AS "repeatOfRunId", rep.body AS "repeatOfBody"
         FROM debrief_review_comments c
         LEFT JOIN users u ON u.id = c."reviewerId"
         LEFT JOIN agent_lessons l ON l.id = c."ideaId"
         LEFT JOIN debrief_review_comments rep ON rep.id = c."repeatOfId"
        WHERE c.id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Comment not found');
    return this.toView(row, reviewerId);
  }

  // --- Comments -----------------------------------------------------------------------

  async addComment(
    runId: string,
    reviewerId: number,
    input: NewComment,
    opts: { repeatOfId?: string } = {},
  ) {
    const run = await this.reviewableRun(runId, reviewerId);
    const body = trimBody(input.body);
    if (input.tag != null && !isCommentTag(input.tag)) {
      throw new BadRequestException('Unknown tag');
    }
    let anchor;
    if (input.parentId) {
      // A reply joins its thread: same run, same anchor, one level deep.
      const parent = await this.comments.findOne({
        where: { id: input.parentId, runId },
      });
      if (!parent)
        throw new NotFoundException('That thread is not on this debrief.');
      if (parent.parentId) {
        throw new BadRequestException(
          'Reply to the first comment in the thread.',
        );
      }
      anchor = {
        anchorKind: parent.anchorKind,
        turnIndex: parent.turnIndex ?? null,
        section: parent.section ?? null,
        spanStart: parent.spanStart ?? null,
        spanEnd: parent.spanEnd ?? null,
        quotedText: parent.quotedText ?? null,
      };
    } else {
      const transcript =
        input.anchorKind === DebriefCommentAnchor.TRANSCRIPT
          ? await this.reviewTranscript(run)
          : [];
      const checked = validateAnchor(input, { transcript, cards: run.cards });
      if ('problem' in checked) throw new BadRequestException(checked.problem);
      anchor = checked.anchor;
    }
    const saved = await this.comments.save(
      this.comments.create({
        tenantId: run.tenantId ?? null,
        runId,
        reviewerId,
        parentId: input.parentId ?? null,
        ...anchor,
        body,
        tag: input.tag ?? null,
        status: DebriefCommentStatus.OPEN,
        repeatOfId: opts.repeatOfId ?? null,
      }),
    );
    return this.viewOne(saved.id, reviewerId);
  }

  private async ownComment(id: string, reviewerId: number) {
    const c = await this.comments.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.reviewerId !== reviewerId) {
      throw new ForbiddenException(
        'Only the person who wrote a comment can change it.',
      );
    }
    return c;
  }

  async editComment(
    id: string,
    reviewerId: number,
    patch: { body?: string; tag?: DebriefCommentTag | null },
  ) {
    const c = await this.ownComment(id, reviewerId);
    const update: Partial<DebriefReviewComment> = {};
    if (patch.body !== undefined) update.body = trimBody(patch.body);
    if (patch.tag !== undefined) {
      if (patch.tag !== null && !isCommentTag(patch.tag)) {
        throw new BadRequestException('Unknown tag');
      }
      update.tag = patch.tag;
    }
    if (Object.keys(update).length) await this.comments.update(c.id, update);
    return this.viewOne(c.id, reviewerId);
  }

  /** Delete your own comment, and its replies. A comment an idea already cites stays. */
  async deleteComment(id: string, reviewerId: number) {
    const c = await this.ownComment(id, reviewerId);
    if (c.ideaId) {
      throw new ConflictException(
        'An improvement idea cites this comment. Resolve it instead.',
      );
    }
    await this.comments.delete(c.id);
    return { deleted: true };
  }

  /** Resolve or re-open a thread. Anyone reviewing may; a reply is resolved with its thread. */
  async setStatus(
    id: string,
    reviewerId: number,
    status: DebriefCommentStatus,
  ) {
    const c = await this.comments.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Comment not found');
    const rootId = c.parentId ?? c.id;
    const resolved = status === DebriefCommentStatus.RESOLVED;
    await this.dataSource.query(
      `UPDATE debrief_review_comments
          SET status = $2, "resolvedBy" = $3, "resolvedAt" = $4, "updatedAt" = now()
        WHERE id = $1 OR "parentId" = $1`,
      [
        rootId,
        status,
        resolved ? reviewerId : null,
        resolved ? new Date() : null,
      ],
    );
    return this.viewOne(rootId, reviewerId);
  }

  /**
   * "Still happening" (spec C5): the problem an earlier comment raised shows
   * up again on a later run. Re-opens the earlier thread and records a new
   * comment on this run that points back at it, so the PM agent sees the
   * problem recur with the idea it already tried.
   */
  async stillHappening(
    commentId: string,
    reviewerId: number,
    input: NewComment & { runId: string },
  ) {
    const earlier = await this.comments.findOne({ where: { id: commentId } });
    if (!earlier) throw new NotFoundException('Comment not found');
    const root = earlier.parentId
      ? await this.comments.findOneOrFail({ where: { id: earlier.parentId } })
      : earlier;
    if (root.runId === input.runId) {
      throw new BadRequestException(
        'Mark it still happening on a later debrief, not the same one.',
      );
    }
    const created = await this.addComment(
      input.runId,
      reviewerId,
      {
        ...input,
        body: input.body?.trim() ? input.body : 'Still happening.',
        tag: input.tag ?? root.tag ?? null,
        parentId: null,
      },
      { repeatOfId: root.id },
    );
    await this.setStatus(root.id, reviewerId, DebriefCommentStatus.OPEN);
    return created;
  }

  /**
   * "What happened to my comment": the caller's comments across runs, newest
   * first, each with the idea it fed and that idea's status.
   */
  async myComments(reviewerId: number, limit = 100) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT c.*, u.name AS "reviewerName",
              l.status AS "ideaStatus", l.text AS "ideaTitle",
              rep."runId" AS "repeatOfRunId", rep.body AS "repeatOfBody",
              r.language, r."recipeKey"
         FROM debrief_review_comments c
         JOIN debrief_runs r ON r.id = c."runId"
         LEFT JOIN users u ON u.id = c."reviewerId"
         LEFT JOIN agent_lessons l ON l.id = c."ideaId"
         LEFT JOIN debrief_review_comments rep ON rep.id = c."repeatOfId"
        WHERE c."reviewerId" = $1 AND c."parentId" IS NULL
        ORDER BY c."createdAt" DESC
        LIMIT $2`,
      [reviewerId, Math.max(1, Math.min(limit, 200))],
    );
    return {
      items: rows.map((c) => ({
        ...this.toView(c, reviewerId),
        language: c.language ?? null,
        sessionType: c.recipeKey ?? null,
      })),
    };
  }

  // --- Verdict ------------------------------------------------------------------------

  /** Give or replace the caller's verdict. Returns the review screen, now with the judge's reading. */
  async setVerdict(
    runId: string,
    reviewerId: number,
    input: { verdict: DebriefReviewVerdict; hardFails?: string[] },
  ) {
    const run = await this.reviewableRun(runId, reviewerId);
    if (!Object.values(DebriefReviewVerdict).includes(input.verdict)) {
      throw new BadRequestException('Choose Good or Needs work.');
    }
    const hardFails = [...new Set(input.hardFails ?? [])];
    const unknown = hardFails.filter(
      (h) => !DEBRIEF_HARD_FAIL_CODES.includes(h as DebriefHardFailCode),
    );
    if (unknown.length) {
      throw new BadRequestException(`${unknown.join(', ')} is not a hard fail`);
    }
    if (input.verdict === DebriefReviewVerdict.GOOD && hardFails.length) {
      throw new BadRequestException(
        'A debrief with a hard fail needs work. Untick it or choose Needs work.',
      );
    }
    await this.dataSource.query(
      `INSERT INTO debrief_reviews ("tenant_id", "runId", "reviewerId", verdict, "hardFails")
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT ("runId", "reviewerId")
       DO UPDATE SET verdict = EXCLUDED.verdict, "hardFails" = EXCLUDED."hardFails",
                     "updatedAt" = now()`,
      [
        run.tenantId ?? null,
        runId,
        reviewerId,
        input.verdict,
        JSON.stringify(hardFails),
      ],
    );
    return this.detail(runId, reviewerId);
  }

  // --- The PM agent -------------------------------------------------------------------

  /**
   * Link comments to the PM agent idea they fed (spec C5). For the PM agent's
   * `idea.propose` to call with the comment ids it cites as evidence; ids that
   * do not exist are ignored.
   */
  async linkIdea(commentIds: string[], ideaId: string): Promise<number> {
    if (!commentIds.length) return 0;
    const res = await this.dataSource.query(
      `UPDATE debrief_review_comments SET "ideaId" = $2, "updatedAt" = now()
        WHERE id = ANY($1::uuid[]) AND "parentId" IS NULL
          AND EXISTS (SELECT 1 FROM agent_lessons l WHERE l.id = $2 AND l."agentKey" = $3)`,
      [commentIds, ideaId, IDEA_AGENT_KEY],
    );
    return Array.isArray(res) ? Number(res[1] ?? 0) : 0;
  }

  /**
   * The gateway's `comments_read` (spec B4, D8): comment threads with their
   * tag, anchor and quoted span — never the transcript, the cards, or who
   * wrote them. `since` is exclusive; `status` defaults to every comment.
   */
  async commentsForAgent(body: {
    since?: string;
    status?: string;
    ids?: string[];
    limit?: number;
  }): Promise<{ comments: GatewayComment[]; next_since: string | null }> {
    const limit = Math.max(1, Math.min(Number(body.limit ?? 100) || 100, 200));
    const params: unknown[] = [];
    const where = [`c."parentId" IS NULL`];
    if (body.since) {
      const since = new Date(body.since);
      if (Number.isNaN(since.getTime())) {
        throw new BadRequestException('since must be an ISO date');
      }
      params.push(since);
      where.push(`c."createdAt" > $${params.length}`);
    }
    if (body.status === 'open' || body.status === 'resolved') {
      params.push(body.status);
      where.push(`c.status = $${params.length}`);
    }
    if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids
        .map(String)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, 200);
      params.push(ids);
      where.push(`c.id = ANY($${params.length}::uuid[])`);
    }
    params.push(limit);
    const top: CommentRow[] = await this.dataSource.query(
      `SELECT c.id, c."runId", c."parentId", c."anchorKind", c."turnIndex", c.section,
              c."spanStart", c."spanEnd", c."quotedText", c.body, c.tag, c.status,
              c."ideaId", l.status AS "ideaStatus", c."repeatOfId", c."createdAt",
              r."recipeKey", r.language
         FROM debrief_review_comments c
         JOIN debrief_runs r ON r.id = c."runId"
         LEFT JOIN agent_lessons l ON l.id = c."ideaId"
        WHERE ${where.join(' AND ')}
        ORDER BY c."createdAt" ASC
        LIMIT $${params.length}`,
      params,
    );
    const replies: CommentRow[] = top.length
      ? await this.dataSource.query(
          `SELECT c.id, c."parentId", c.body, c.tag, c."createdAt"
             FROM debrief_review_comments c
            WHERE c."parentId" = ANY($1::uuid[])`,
          [top.map((t) => t.id)],
        )
      : [];
    const comments = toGatewayComments(top, replies);
    return {
      comments,
      next_since:
        top.length === limit ? comments[comments.length - 1].created_at : null,
    };
  }
}
