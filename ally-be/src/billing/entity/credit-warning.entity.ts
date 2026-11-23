import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A warning email that went out: one per threshold per grant epoch (account) or top-up epoch
 * (chatbot budget). The primary key is the "once"; a new grant or top-up opens a new epoch.
 */
@Entity('credit_warnings')
export class CreditWarning {
  @PrimaryColumn({ type: 'varchar', length: 10, name: 'subject_type' })
  subjectType!: 'account' | 'budget';

  @PrimaryColumn({ type: 'varchar', length: 64, name: 'subject_id' })
  subjectId!: string;

  @PrimaryColumn({ type: 'int' })
  epoch!: number;

  @PrimaryColumn({ type: 'smallint' })
  percent!: number;

  @CreateDateColumn({ name: 'sent_at' })
  sentAt!: Date;
}
