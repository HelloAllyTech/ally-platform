import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  PmLessonScope,
  PmLessonStatus,
  PmMemoryKind,
  PmMemorySource,
  PmQuestionScope,
} from '../enum/pm-agent.enum';

/**
 * A typed, provenance-tracked memory fact (or a lesson). Data, never instructions:
 * lanes retrieve the top-k relevant ones and fence them. Admin-editable.
 */
@Entity('pm_agent_memory')
@Index('idx_pm_agent_memory_active', ['kind', 'active'])
@Index('idx_pm_agent_memory_key', ['key'])
export class PmAgentMemory extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, default: PmMemoryKind.FACT })
  kind!: PmMemoryKind;

  @Column({ type: 'varchar', length: 160 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'varchar', length: 16, default: PmQuestionScope.GLOBAL })
  scope!: PmQuestionScope | PmLessonScope;

  @Column({ type: 'varchar', length: 16 })
  source!: PmMemorySource;

  @Column({ type: 'uuid', nullable: true })
  sourceCardId?: string | null;

  /** 0–1; null when a person stated it. */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence?: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  supersedesId?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;

  // ── lesson-only columns (migration 1982000000600; NULL / false on facts) ──
  // A lesson's `active` mirrors `lessonStatus === 'active'`, so every reader that filters on
  // `active` keeps working. `scope` holds a PmLessonScope for lessons.

  @Column({ type: 'varchar', length: 16, nullable: true })
  lessonStatus?: PmLessonStatus | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  lane?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  category?: string | null;

  /** Decisions in the last 90 days that agree with the lesson (recomputed in code). */
  @Column({ type: 'int', nullable: true })
  supportCount?: number | null;

  /** supporting ÷ matching decisions, 0–1. */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  supportRatio?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidenceCardIds?: string[] | null;

  /** The eval gate's result; null when it could not run (budget, too few cards). */
  @Column({ type: 'jsonb', nullable: true })
  evalResult?: PmLessonEvalResult | null;

  @Column({ type: 'boolean', default: false })
  requiresConfirm!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastSupportedAt?: Date | null;

  /** The structured condition the support was computed from (see lessons/pm-lesson-data.ts). */
  @Column({ type: 'jsonb', nullable: true })
  predicate?: PmLessonStoredPredicate | null;

  /** Append-only audit of admin actions on a lesson (confirm, edit, remove). */
  @Column({ type: 'jsonb', nullable: true })
  lessonEvents?: PmLessonEvent[] | null;
}

export interface PmLessonEvalResult {
  passed: boolean;
  agreementBefore: number;
  agreementAfter: number;
  sampleSize: number;
}

export interface PmLessonStoredPredicate {
  categories?: string[];
  lanes?: string[];
  sizes?: string[];
  risks?: string[];
  words?: string[];
  expects?: 'accept' | 'reject';
}

export interface PmLessonEvent {
  type: string;
  at: string;
  actorUserId: number | null;
  detail?: Record<string, string | number | boolean | null>;
}
