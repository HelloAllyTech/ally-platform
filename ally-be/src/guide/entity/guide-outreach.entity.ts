import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** One reminder Ally sent, or an appointment it held back (plan §4.8). */
@Entity('guide_outreach')
export class GuideOutreach extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: 'appointment' | 'idle';

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: 'sent' | 'skipped' | 'failed';

  /** Why it was held back (crisis_recent, care_recent, opted_out, …). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reason?: string | null;

  @Column({ type: 'jsonb', default: {} })
  channels!: { inApp?: boolean; email?: boolean; push?: boolean };

  @Column({ type: 'varchar', length: 120, nullable: true })
  title?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body?: string | null;

  /** `model` or `template` (the fallback when the lint or the model fails). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  writer?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
