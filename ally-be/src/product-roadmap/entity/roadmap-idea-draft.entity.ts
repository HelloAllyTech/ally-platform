import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A raw, spoken-or-typed idea parked before the guided interview.
 *
 * PRIVATE to its author and deliberately NOT an opportunity: it has no code, no votes, no rank,
 * no stage and never appears on the board. Nothing here is readiness-checked. The author later
 * opens it, the copilot interview is seeded with `rawText`, and filing that interview creates the
 * real opportunity and deletes the draft.
 */
@Entity('roadmap_idea_drafts')
@Index('idx_roadmap_idea_drafts_owner', ['ownerUserId', 'updatedAt'], {
  where: '"deletedAt" IS NULL',
})
export class RoadmapIdeaDraft extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** No FK, like createdBy elsewhere on the roadmap. */
  @Column({ type: 'int' })
  ownerUserId!: number;

  @Column({ type: 'text' })
  rawText!: string;

  /** 'voice' when any of it was dictated, else 'typed'. Informational. */
  @Column({ type: 'varchar', length: 10, default: 'typed' })
  captureMode!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
