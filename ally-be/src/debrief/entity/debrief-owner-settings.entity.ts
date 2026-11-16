import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The debrief owner settings (v9 FR-60; migration 1981002100000): one row,
 * id 1. `values` holds only what a person changed (absent keys are the code
 * defaults in debrief-owner-settings.constants.ts); `proposal` is the
 * baseline job's latest suggestion, applied only when a person accepts it.
 */
@Entity('debrief_owner_settings')
export class DebriefOwnerSettings extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  values!: Record<string, number | boolean | string>;

  @Column({ type: 'jsonb', nullable: true })
  proposal?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  proposedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;

  /**
   * What the PM agent may do alone (migration 1981900740000): the policy
   * matrix, per-organisation overrides (tighten only) and automatic re-locks.
   * Read through DebriefAutonomyService; null reads as today's defaults.
   */
  @Column({ type: 'jsonb', nullable: true })
  autonomy?: Record<string, any> | null;

  /**
   * Who last changed each setting (migration 1981901500000): by key,
   * `{by, byId, at, why, changeId}`. A person's edit, or the PM agent's
   * tuning of the test settings (v2 A10), which Settings › Tests shows.
   */
  @Column({ type: 'jsonb', nullable: true })
  changes?: Record<string, any> | null;
}
