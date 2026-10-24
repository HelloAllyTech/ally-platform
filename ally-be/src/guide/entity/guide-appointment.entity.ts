import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  GuideAppointmentPurpose,
  GuideAppointmentStatus,
} from '../enum/guide.enum';

/**
 * The time a learner chose to come back (plan §4.8). Stored with the IANA
 * timezone so the reminder fires at local wall-clock time across DST changes.
 */
@Entity('guide_appointments')
export class GuideAppointment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'timestamptz' })
  at!: Date;

  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @Column({
    type: 'varchar',
    length: 12,
    default: GuideAppointmentStatus.SCHEDULED,
  })
  status!: GuideAppointmentStatus;

  /** A session (closing ritual) or the finale's spaced-recall look back. */
  @Column({
    type: 'varchar',
    length: 16,
    default: GuideAppointmentPurpose.SESSION,
  })
  purpose!: GuideAppointmentPurpose;

  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;
}
