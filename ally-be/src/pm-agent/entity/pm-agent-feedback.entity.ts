import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { PmFeedbackStatus } from '../enum/pm-agent.enum';

/**
 * Feedback on a card = a revision task. The pipeline's `revisions` lane consumes PENDING
 * rows first on the next run (or at once when `reviseNow`), producing a successor card.
 */
@Entity('pm_agent_feedback')
@Index('idx_pm_agent_feedback_status', ['status'])
export class PmAgentFeedback extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cardId!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  chips!: string[];

  @Column({ type: 'boolean', default: false })
  reviseNow!: boolean;

  @Column({ type: 'varchar', length: 16, default: PmFeedbackStatus.PENDING })
  status!: PmFeedbackStatus;

  @Column({ type: 'uuid', nullable: true })
  successorCardId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;
}
