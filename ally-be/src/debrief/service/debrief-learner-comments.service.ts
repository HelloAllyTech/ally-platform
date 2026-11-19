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
