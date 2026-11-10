import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { DensityCap, RetrievalDefaults } from '../profiles/profile.types';

export interface ClLoopSettings {
  /** Share of live searches the judge grades, 0–1. */
  judgeSampleRate?: number;
  /** Loops switched off for this collection, by name. */
  paused?: string[];
}

/**
 * One Context Library collection: the settings an admin (or a learning loop) can tune.
 *
 * The collection's SHAPE — fields, prompts, card — is its profile, in code. This row holds
 * only what may change at runtime: the density cap, the active search setup, which index
 * version is live, and the next code number.
 */
@Entity('cl_collections')
export class ClCollection extends BaseWithoutTenantEntity {
  /** Slug, e.g. `first_principles`. */
  @PrimaryColumn({ type: 'varchar', length: 48 })
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 4, name: 'code_prefix' })
  codePrefix!: string;

  /** The next code number. Taken with UPDATE … RETURNING, so two writers never share one. */
  @Column({ type: 'int', name: 'next_code', default: 1 })
  nextCode!: number;

  @Column({ type: 'int', name: 'profile_version', default: 1 })
  profileVersion!: number;

  /** Overrides the profile's density cap; null means use the profile's. */
  @Column({ type: 'jsonb', name: 'density_cap', nullable: true })
  densityCap?: DensityCap | null;

  /**
   * The search setup in force (retriever weights, re-rank, MMR λ, contextualisation). Only the
   * tuning loop or an admin picking a setup that has a benchmark report changes it.
   */
  @Column({ type: 'jsonb', name: 'active_search_setup', nullable: true })
  activeSearchSetup?: RetrievalDefaults | null;

  /** The setup in force before the last promotion: what an automatic rollback restores. */
  @Column({ type: 'jsonb', name: 'previous_search_setup', nullable: true })
  previousSearchSetup?: RetrievalDefaults | null;

  @Column({ type: 'timestamp', name: 'setup_promoted_at', nullable: true })
  setupPromotedAt?: Date | null;

  /** Loop switches and the judge's sample rate; null means the defaults in the constants. */
  @Column({ type: 'jsonb', name: 'loop_settings', nullable: true })
  loopSettings?: ClLoopSettings | null;

  /** Which `Ctx<Collection>_v{N}` index is live. Blue/green: build N+1, judge it, flip this. */
  @Column({ type: 'int', name: 'active_index_version', default: 1 })
  activeIndexVersion!: number;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: 'active' | 'retiring';
}
