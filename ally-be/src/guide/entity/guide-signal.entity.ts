import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A learning-loop signal (plan §7.13): thumbs, nudge accepted, drop-off,
 * correction, CARE/CRISIS entered… Ids and counts only, never text.
 * Pseudonymised and kept 2 years.
 */
@Entity('guide_signals')
@Index('idx_guide_signals_kind_occurred', ['kind', 'occurredAt'])
export class GuideSignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ type: 'real', nullable: true })
  value?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, any> | null;

  @Column({ type: 'uuid', nullable: true })
  threadId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  messageId?: string | null;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'uuid', nullable: true })
  visitorId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  arm?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  occurredAt!: Date;
}
