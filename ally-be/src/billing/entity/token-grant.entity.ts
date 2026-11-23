import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { numericTransformer } from '../util/numeric.transformer';

export enum TokenGrantStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

/** One token allowance Ally assigned (CR1 Part B). Usage is taken from the oldest grant first. */
@Entity('token_grants')
export class TokenGrant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'bigint', transformer: numericTransformer })
  amount!: number;

  /** What's left of it this period (renewing grants refill to `amount`). */
  @Column({ type: 'bigint', transformer: numericTransformer })
  remaining!: number;

  /** Used from it this period. */
  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  used!: number;

  @Column({ type: 'boolean', default: false })
  renewMonthly!: boolean;

  @Column({ type: 'smallint', nullable: true })
  renewDay!: number | null;

  @Column({ type: 'timestamp', nullable: true })
  nextRenewalAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: TokenGrantStatus.ACTIVE })
  status!: TokenGrantStatus;

  @Column({ type: 'text' })
  note!: string;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
