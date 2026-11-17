import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RoadmapNotificationKind } from '../enum/product-planning.enum';

/**
 * One notice to one person in the Roadmap v2 inbox (plans/roadmap-builder-merge
 * §4.8, §5.6): the single stream that replaces `builder_notifications` (creator
 * only) and `plan_notifications` (shown only inside My ideas).
 *
 * Written by RoadmapInboxService, which applies the recipient rules. Until
 * cutover the old writers dual-write here and their own tables stay the ones
 * read. `payload` is data for the frontend to word (ids, counts, and the old
 * writer's sentence while dual-writing); a decline reason is put only on the
 * author's row.
 *
 * `groupKey` is item + kind + 10-minute bucket, so a burst about one idea
 * collapses into one line in the inbox.
 */
@Entity('roadmap_notifications')
@Index('idx_roadmap_notifications_recipient', ['recipientUserId', 'readAt'])
@Index('idx_roadmap_notifications_recipient_created', [
  'recipientUserId',
  'createdAt',
])
export class RoadmapNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  recipientUserId!: number;

  /** The idea (roadmap_opportunities.id). Null for a session with no idea yet. */
  @Column({ type: 'uuid', nullable: true })
  itemId?: string | null;

  /** The plan or Builder session it came from, when there is one. */
  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  @Column({ type: 'varchar', length: 24 })
  kind!: RoadmapNotificationKind;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 160 })
  groupKey!: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
