import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { SeatCycle, SeatKind, SeatStatus } from '../enum/billing.enum';

/**
 * A seat on a published assistant for one invited person (CR1 Part C). Included seats come with
 * the plan and don't lapse while the subscription is active; extra seats renew on their own date.
 */
@Entity('seats')
export class Seat extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  chatbotId!: string;

  @Column({ type: 'uuid' })
  seatTypeId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: SeatKind;

  /** Lower case. NULL: not assigned yet. */
  @Column({ type: 'varchar', length: 320, nullable: true })
  assigneeEmail!: string | null;

  @Column({ type: 'int', nullable: true })
  assigneeUserId!: number | null;

  /** Its day of the month is when the seat's message counter resets. */
  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'varchar', length: 20, default: SeatCycle.MONTHLY })
  cycle!: SeatCycle;

  /** Extra seats only. */
  @Column({ type: 'date', nullable: true })
  nextRenewal!: string | null;

  @Column({ type: 'varchar', length: 20, default: SeatStatus.ACTIVE })
  status!: SeatStatus;

  @Column({ type: 'int', nullable: true })
  addedBy!: number | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
