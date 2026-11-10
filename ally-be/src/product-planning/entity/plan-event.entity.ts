import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanEventKind } from '../enum/product-planning.enum';

/**
 * One thing that happened to a plan: taken on, handed back, filed, a budget
 * raised, a finding dismissed (PlanEventKind).
 *
 * APPEND-ONLY. No update path exists and none should be added: the timeline
 * and "who decided what" are only trustworthy if rows never change. Hence no
 * updatedAt and no soft delete. Rows go when their session is hard-deleted
 * (the expiry purge of an unfiled draft), by FK cascade.
 *
 * `actorUserId` null means the system did it (an auto-release, a scheduled
 * review). No FK, like createdBy elsewhere.
 */
@Entity('plan_events')
@Index('idx_plan_events_session_at', ['sessionId', 'at'])
export class PlanEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 32, enum: PlanEventKind })
  kind!: PlanEventKind;

  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  /** Kind-specific detail: { from, to } for a stage change, { amountUsd } for a budget raise. */
  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;
}
