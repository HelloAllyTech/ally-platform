import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CostAlertKind } from '../enum/billing.enum';

/** An alert Ally was sent. Unique per (kind, subject, day), which is what makes each fire once (CR1). */
@Entity('cost_alerts')
@Index('uq_cost_alerts_once', ['kind', 'subjectKey', 'day'], { unique: true })
export class CostAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'varchar', length: 30 })
  kind!: CostAlertKind;

  @Column({ type: 'varchar', length: 200 })
  subjectKey!: string;

  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;
}
