import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { SubscriptionStatus } from '../enum/billing.enum';
import { numericTransformer } from '../util/numeric.transformer';

/** A chatbot creator's plan (CR1 Part C). One per creator; their assistants count against it. */
@Entity('subscriptions')
export class Subscription extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unique: true })
  userId!: number;

  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 20, default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  /** Its day of the month is when the customer and owner-side counters reset. */
  @Column({ type: 'date' })
  periodStart!: string;

  @Column({ type: 'date', nullable: true })
  periodEnd!: string | null;

  /** This creator's own monthly cost cap (NULL = their plan's). */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  costCapMicros!: number | null;

  /** Never capped, whatever the plan says: Ally's team and test accounts. */
  @Column({ type: 'boolean', default: false })
  costCapOff!: boolean;

  @Column({ type: 'int', nullable: true })
  setBy!: number | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
