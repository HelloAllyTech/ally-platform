import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  DebriefFeedbackKind,
  DebriefFeedbackStatus,
  DebriefFlagReason,
} from '../enum/debrief-run.enum';

/**
 * A learner's "Was this helpful?" answer or "This isn't right" flag on a
 * Debrief agent debrief (migration 1980820000000). A flag is reviewed by the
 * Ally team: kept or removed, and the learner sees the outcome on the card.
 */
@Entity('debrief_run_feedback')
export class DebriefFeedback extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 12 })
  kind!: DebriefFeedbackKind;

  @Column({ type: 'boolean', nullable: true })
  helpful?: boolean | null;

  /** The card: `important_moment`, `what_worked[0]`, `work_on_this[1]`, … */
  @Column({ type: 'varchar', length: 48, nullable: true })
  section?: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reason?: DebriefFlagReason | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ type: 'boolean', default: false })
  urgent!: boolean;

  @Column({ type: 'varchar', length: 12 })
  status!: DebriefFeedbackStatus;

  @Column({ type: 'int', nullable: true })
  resolvedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote?: string | null;
}
