import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One person's Roadmap v2 preferences (plans/roadmap-builder-merge §5.7b). A
 * missing row means every default: no weekly digest.
 */
@Entity('roadmap_user_preferences')
export class RoadmapUserPreference {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  /** "Your ideas this week" by email, from the product-updates digest. Off by default. */
  @Column({ type: 'boolean', default: false })
  weeklyDigest!: boolean;

  /** When the weekly digest last went to this person, so a week never sends twice. */
  @Column({ type: 'timestamptz', nullable: true })
  lastDigestAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
