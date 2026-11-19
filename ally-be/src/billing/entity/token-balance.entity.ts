import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

/** A user's token allowance state (CR1 Part B). No row: no allowance, nothing is limited. */
@Entity('token_balances')
export class TokenBalance {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** Ally's team and test accounts: counted, never limited. */
  @Column({ type: 'boolean', default: false })
  unlimited!: boolean;

  /** Used past zero by a run already under way; taken from the next grant or renewal. */
  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  overdraft!: number;

  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  usedThisMonth!: number;

  @Column({ type: 'date' })
  monthStart!: string;
}
