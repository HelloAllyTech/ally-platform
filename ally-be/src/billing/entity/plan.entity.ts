import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { numericTransformer } from '../util/numeric.transformer';

/** A plan for chatbot creators (CR1 Part C). A NULL limit is unlimited. Data, not code. */
@Entity('plans')
export class Plan extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'int', nullable: true })
  maxPublished!: number | null;

  @Column({ type: 'int', default: 0 })
  includedSeats!: number;

  @Column({ type: 'uuid', nullable: true })
  includedSeatTypeId!: string | null;

  @Column({ type: 'int', nullable: true })
  customerConversations!: number | null;

  @Column({ type: 'int', nullable: true })
  ownerRuns!: number | null;

  /** False for `internal`: invited people chat without a seat. */
  @Column({ type: 'boolean', default: true })
  seatsRequired!: boolean;

  /** For Ally admin → Costs (margins) only; never shown to customers. */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  priceMicros!: number | null;

  /**
   * The most a creator on this plan may cost Ally in one plan period (NULL = no cap). Ally admin
   * only: owners never see it. A subscription can carry its own.
   */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  costCapMicros!: number | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}
