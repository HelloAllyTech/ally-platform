import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanNotificationKind } from '../enum/product-planning.enum';

/**
 * One in-app notice to one person about one plan: an author told their idea
 * was taken on, a lead nudged after a quiet week, an author asked a question.
 *
 * Separate from `builder_notifications`, which is Builder's inbox and is read
 * only by people holding the Builder toggle. Plan authors are usually not
 * Builder users, so their notices live with the roadmap, where they are.
 * Kept to at most one unread notice per (recipient, plan, kind): a repeat
 * refreshes the existing row instead of piling up.
 */
@Entity('plan_notifications')
@Index('idx_plan_notifications_recipient', ['recipientUserId', 'readAt'])
export class PlanNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  recipientUserId!: number;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 24, enum: PlanNotificationKind })
  kind!: PlanNotificationKind;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
