import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A judged debrief the weekly "Agreement sample" job put in the clinical
 * advisor's queue at random (migration 1981900790000), so the κ gate is not
 * built only from debriefs someone chose to open. Leaves the queue once it
 * has a verdict.
 */
@Entity('debrief_agreement_samples')
export class DebriefAgreementSample {
  @PrimaryColumn({ type: 'uuid' })
  runId!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Index('debrief_agreement_samples_sampled_idx')
  @Column({ type: 'timestamp', default: () => 'now()' })
  sampledAt!: Date;
}
