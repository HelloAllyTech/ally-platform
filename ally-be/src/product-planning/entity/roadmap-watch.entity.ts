import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoadmapWatchLevel } from '../enum/product-planning.enum';

/**
 * How closely one person follows one idea (§4.8): All (questions and
 * milestones), Milestones, or None. A missing row means the default for the
 * person's relationship: All for the author and the lead, Milestones for a
 * voter, nothing otherwise. Voting writes a Milestones row only when there is
 * none, so an explicit choice is never overwritten.
 */
@Entity('roadmap_watches')
@Index('idx_roadmap_watches_item', ['itemId'])
export class RoadmapWatch {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  @PrimaryColumn({ type: 'uuid' })
  itemId!: string;

  @Column({ type: 'varchar', length: 10 })
  level!: RoadmapWatchLevel;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
