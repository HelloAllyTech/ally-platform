import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanStage } from '../enum/product-planning.enum';

/**
 * One priced model call (or one runner step) made for a plan: the ledger behind
 * the spend meter (plans/roadmap-owns-planning rev 5.1 §B.11).
 *
 * WHY ITS OWN LEDGER. `builder_sessions.totalCostUsd` is runner spend only, and
 * `llm_usage` is written fire-and-forget with no cost column — a plan's
 * interview, copilot and specialist calls were invisible on the session. Rows
 * here are written AWAITED and priced at write time, so the meter is never
 * behind and a total is always the sum of its rows.
 *
 * `priced = false` means the model had no price when the row was written; its
 * costUsd is 0 and the meter says "approximate" rather than showing a total
 * that is falsely low. APPEND-ONLY: a price is what it was when spent.
 *
 * `sessionId` is null only for work that belongs to no plan yet (the weekly
 * signal scout).
 */
@Entity('plan_spend_entries')
@Index('idx_plan_spend_entries_session_at', ['sessionId', 'at'])
export class PlanSpendEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  @Column({ type: 'varchar', length: 16, enum: PlanStage, nullable: true })
  stage?: PlanStage | null;

  /** Whose turn caused the call; null for system work (scheduled reviews). */
  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  /** Registry id of the specialist, or null for the conductor itself. */
  @Column({ type: 'varchar', length: 48, nullable: true })
  specialist?: string | null;

  /** AI task registry id (src/llm/constants/ai-task-registry.constants.ts). */
  @Column({ type: 'varchar', length: 96 })
  taskId!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ type: 'varchar', length: 80 })
  model!: string;

  @Column({ type: 'int', default: 0 })
  tokensIn!: number;

  @Column({ type: 'int', default: 0 })
  tokensOut!: number;

  @Column({ type: 'int', default: 0 })
  cachedTokens!: number;

  @Column({ type: 'int', default: 0 })
  cacheWriteTokens!: number;

  /** USD; numeric so sums are exact. A string, as TypeORM returns numerics. */
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'boolean', default: true })
  priced!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;
}
