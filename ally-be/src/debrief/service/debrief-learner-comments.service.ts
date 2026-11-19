import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebriefReviewComment } from '../entity/debrief-review-comment.entity';
import {
  DebriefCommentAnchor,
  DebriefCommentSource,
  DebriefCommentStatus,
  DebriefLearnerFeature,
} from '../enum/debrief-review.enum';
import { trimCommentBody, validateAnchor } from '../util/debrief-review.util';
import { DebriefFeedbackService } from './debrief-feedback.service';
import { DebriefLearnerFeaturesService } from './debrief-learner-features.service';

export const LEARNER_COMMENT_MAX_ITEMS = 10;

export interface LearnerCommentItem {
  section: string;
  spanStart: number;
  spanEnd: number;
  quotedText: string;
  body: string;
}

export interface LearnerOwnComment {
  id: string;
  /** The card and field, or null for a comment on the debrief as a whole. */
  section: string | null;
  quotedText: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  body: string;
  createdAt: string;
}

export interface LearnerCommentListItem {
  id: string;
  runId: string;
  sessionId: string;
  section: string | null;
  quotedText: string | null;
  body: string;
  status: string;
  language: string | null;
  tenantName: string | null;
  learnerName: string | null;
  createdAt: string;
}

export interface LearnerCommentsInput {
  /** A comment on the debrief as a whole. */
  overall?: string;
  /** Comments on words the learner selected, each pinned to a card field. */
  items?: LearnerCommentItem[];
}

/**
 * A learner's comments on selected words in their own web debrief, sent together from the feedback
 * box. Each is stored as an expert-comment row with `source = 'learner'`, so the PM agent's
 * `comments_read` and the Console's review lists carry it, with the words and the card they came
 * from. The selected words are checked against the card's text, as an expert's are.
 */
@Injectable()
export class DebriefLearnerCommentsService {
  constructor(
    @InjectRepository(DebriefReviewComment)
    private readonly comments: Repository<DebriefReviewComment>,
    private readonly feedback: DebriefFeedbackService,
    private readonly features: DebriefLearnerFeaturesService,
  ) {}

  async add(
    sessionId: string,
    userId: number,
    input: LearnerCommentsInput,
  ): Promise<{ saved: number }> {
    if (
      !(await this.features.isEnabled(
        DebriefLearnerFeature.SELECTION_COMMENTS,
        userId,
      ))
    ) {
      throw new ForbiddenException(
        'Commenting on selected words is not on for you yet.',
      );
    }
    const items = input.items ?? [];
    if (items.length > LEARNER_COMMENT_MAX_ITEMS) {
      throw new BadRequestException(
        `Send at most ${LEARNER_COMMENT_MAX_ITEMS} comments at once.`,
      );
    }
    const run = await this.feedback.ownLiveRun(sessionId, userId);
    const rows: DebriefReviewComment[] = [];
    for (const item of items) {
      const body = trimCommentBody(item.body);
      if (item.spanStart == null || item.spanEnd == null || !item.quotedText) {
        throw new BadRequestException('Select some words to comment on.');
      }
      const checked = validateAnchor(
        {
          anchorKind: DebriefCommentAnchor.CARD,
          section: item.section,
          spanStart: item.spanStart,
          spanEnd: item.spanEnd,
          quotedText: item.quotedText,
        },
        { transcript: [], cards: run.cards },
      );
      if ('problem' in checked) throw new BadRequestException(checked.problem);
      rows.push(this.row(run.id, run.tenantId, userId, checked.anchor, body));
    }
    if (input.overall?.trim()) {
      const body = trimCommentBody(input.overall);
      rows.push(
        this.row(
          run.id,
          run.tenantId,
          userId,
          {
            anchorKind: DebriefCommentAnchor.DEBRIEF,
            turnIndex: null,
            section: null,
            spanStart: null,
            spanEnd: null,
            quotedText: null,
          },
          body,
        ),
      );
    }
    if (rows.length === 0) {
      throw new BadRequestException('Write a comment first.');
    }
    await this.comments.save(rows);
    return { saved: rows.length };
  }

  /** A learner's own comments on one debrief, oldest first: what they see under their feedback box. */
  async mine(runId: string, userId: number): Promise<LearnerOwnComment[]> {
    const rows: Array<{
      id: string;
      section: string | null;
      quotedText: string | null;
      spanStart: number | null;
      spanEnd: number | null;
      body: string;
      createdAt: Date;
    }> = await this.comments.query(
      `SELECT id, section, "quotedText", "spanStart", "spanEnd", body, "createdAt"
         FROM debrief_review_comments
        WHERE "runId" = $1 AND "reviewerId" = $2 AND source = 'learner' AND "parentId" IS NULL
        ORDER BY "createdAt" ASC`,
      [runId, userId],
    );
    return rows.map((r) => ({
      id: r.id,
      section: r.section,
      quotedText: r.quotedText,
      spanStart: r.spanStart,
      spanEnd: r.spanEnd,
      body: r.body,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /**
   * Every learner comment across debriefs, newest first, for the Console's Learner comments view.
   * `before` is the `next` of the previous page.
   */
  async list(
    limit: number,
    before?: string,
  ): Promise<{ items: LearnerCommentListItem[]; next: string | null }> {
    const size = Math.max(1, Math.min(Number(limit) || 50, 100));
    const at = before ? new Date(before) : null;
    if (at && Number.isNaN(at.getTime())) {
      throw new BadRequestException('before must be an ISO date');
    }
    const params: unknown[] = [];
    let where = `c.source = 'learner' AND c."parentId" IS NULL`;
    if (at) {
      params.push(at);
      where += ` AND c."createdAt" < $${params.length}`;
    }
    params.push(size + 1);
    const rows: Array<Record<string, any>> = await this.comments.query(
      `SELECT c.id, c."runId", r."scenarioSessionId" AS "sessionId", c.section, c."quotedText",
              c.body, c.status, c."createdAt", r.language, t.name AS "tenantName",
              u.name AS "learnerName"
         FROM debrief_review_comments c
         JOIN debrief_runs r ON r.id = c."runId"
         LEFT JOIN users u ON u.id = c."reviewerId"
         LEFT JOIN tenants t ON t.id::text = r.tenant_id
        WHERE ${where}
        ORDER BY c."createdAt" DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, size);
    return {
      items: page.map((r) => ({
        id: r.id,
        runId: r.runId,
        sessionId: r.sessionId,
        section: r.section ?? null,
        quotedText: r.quotedText ?? null,
        body: r.body,
        status: r.status,
        language: r.language ?? null,
        tenantName: r.tenantName ?? null,
        learnerName: r.learnerName ?? null,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
      next:
        rows.length > size
          ? new Date(page[page.length - 1].createdAt).toISOString()
          : null,
    };
  }

  private row(
    runId: string,
    tenantId: string | null | undefined,
    userId: number,
    anchor: Pick<
      DebriefReviewComment,
      | 'anchorKind'
      | 'turnIndex'
      | 'section'
      | 'spanStart'
      | 'spanEnd'
      | 'quotedText'
    >,
    body: string,
  ): DebriefReviewComment {
    return this.comments.create({
      tenantId: tenantId ?? null,
      runId,
      reviewerId: userId,
      parentId: null,
      ...anchor,
      body,
      tag: null,
      status: DebriefCommentStatus.OPEN,
      source: DebriefCommentSource.LEARNER,
    });
  }
}
