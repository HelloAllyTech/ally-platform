import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
  DebriefCommentTag,
} from '../enum/debrief-review.enum';

/**
 * An expert's comment on a Debrief agent run (spec B2/B3, migration
 * 1981900700000), pinned to a span of a transcript turn, a span of a card, or
 * the debrief as a whole. A reply carries `parentId` and its thread's anchor.
 *
 * The PM agent reads `body`, `tag`, the anchor and `quotedText` through the
 * gateway's `comments_read` (D8); learners never see comments, and Builder or
 * Bug Hunter never receive their text (B4). `ideaId` is the PM agent idea
 * (`agent_lessons`) the comment fed; `repeatOfId` is an earlier comment a
 * reviewer marked "still happening" on this run.
 */
@Entity('debrief_review_comments')
@Index('debrief_review_comments_run_idx', ['runId', 'createdAt'])
@Index('debrief_review_comments_created_idx', ['createdAt'])
export class DebriefReviewComment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'int' })
  reviewerId!: number;

  /** The comment this one replies to; replies are one level deep. */
  @Column({ type: 'uuid', nullable: true })
  parentId?: string | null;

  @Column({ type: 'varchar', length: 12 })
  anchorKind!: DebriefCommentAnchor;

  /** The transcript turn (1-based, the judge's numbering), for a transcript anchor. */
  @Column({ type: 'int', nullable: true })
  turnIndex?: number | null;

  /** The card and field, e.g. `work_on_this[0].why`, for a card anchor. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  section?: string | null;

  /** Character offsets into the turn's or the card field's text. */
  @Column({ type: 'int', nullable: true })
  spanStart?: number | null;

  @Column({ type: 'int', nullable: true })
  spanEnd?: number | null;

  /** The selected text, checked against the turn or card field when saved. */
  @Column({ type: 'text', nullable: true })
  quotedText?: string | null;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  tag?: DebriefCommentTag | null;

  @Column({ type: 'varchar', length: 10, default: DebriefCommentStatus.OPEN })
  status!: DebriefCommentStatus;

  @Column({ type: 'int', nullable: true })
  resolvedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  ideaId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  repeatOfId?: string | null;
}
