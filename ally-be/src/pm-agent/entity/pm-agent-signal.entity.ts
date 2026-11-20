import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { PmSignalStatus } from '../enum/pm-agent.enum';

/**
 * A UX Signals finding kept as evidence for the agent (replaces writing into the old
 * Suggestions queue). Aggregates only; one row per (source, key), refreshed in place.
 */
@Entity('pm_agent_signals')
@Index('idx_pm_agent_signals_status', ['status'])
export class PmAgentSignal extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, default: 'ux_signals' })
  source!: string;

  @Column({ type: 'varchar', length: 80 })
  detector!: string;

  @Column({ type: 'varchar', length: 160 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  summary!: string;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  severity?: string | null;

  @Column({ type: 'varchar', length: 16, default: PmSignalStatus.NEW })
  status!: PmSignalStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  cardId?: string | null;
}
