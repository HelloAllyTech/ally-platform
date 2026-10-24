import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** One firing of an Ally alert rule (plan §7.12). Numbers only. */
@Entity('guide_alerts')
export class GuideAlert extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48 })
  rule!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: 'warning' | 'critical';

  /** Rule plus its window: one row per rule per window. */
  @Column({ type: 'varchar', length: 120, unique: true })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 500 })
  summary!: string;

  @Column({ type: 'jsonb', default: {} })
  value!: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true })
  notifiedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  acknowledgedBy?: number | null;
}
