import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One person's acceptance of one version of the responder agreement (Stage 1b). */
@Entity('responder_agreements')
@Index('UQ_responder_agreements_user_version', ['userId', 'version'], {
  unique: true,
})
export class ResponderAgreement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', name: 'user_id' })
  userId!: number;

  @Column({ type: 'varchar', length: 16 })
  version!: string;

  @Column({ type: 'timestamptz', name: 'accepted_at', default: () => 'now()' })
  acceptedAt!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string | null;
}
