import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** What one cutover run moved (the retired RoadmapCutoverService.run). */
export interface RoadmapCutoverCounts {
  /** `roadmap_idea_drafts` rows copied into private plan drafts. */
  draftsMoved: number;
  /** Direct Builder sessions that were given a filed idea. */
  sessionsFiled: number;
  /** Opportunities whose null `reviewState` became `accepted`. */
  reviewsAccepted: number;
  builders: number;
  owners: number;
}

/**
 * One run of the Roadmap cutover (Roadmap v2 P6, migration 1983700000000):
 * who switched Roadmap on, when, what moved, and the Builder and Owner lists
 * they confirmed (§3.3). Platform-wide, so no tenant. Append-only: a second
 * run (after a rollback, say) adds a row rather than editing the first.
 *
 * The cutover itself is retired (it ran in production on 2026-11-20) and
 * nothing reads or writes this table now. The entity stays, unregistered in any
 * module, as the record of the table's shape until the audit rows are exported
 * and a migration drops it.
 */
@Entity('roadmap_cutover_log')
@Index('idx_roadmap_cutover_log_at', ['at'])
export class RoadmapCutoverLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** No FK, like createdBy elsewhere on the roadmap. */
  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  counts!: RoadmapCutoverCounts;

  /** User ids only, never emails. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  confirmedBuilderIds!: number[];

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  confirmedOwnerIds!: number[];

  /** `roadmapV2Enabled` was already on when this run started (a catch-up run). */
  @Column({ type: 'boolean', default: false })
  flagWasOn!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;
}
