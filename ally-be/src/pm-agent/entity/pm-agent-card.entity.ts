import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  PmAcceptPath,
  PmCardCategory,
  PmCardKind,
  PmCardStatus,
  PmRejectReasonChip,
} from '../enum/pm-agent.enum';

/**
 * One card: a recommendation or a question (docs/pm-agent.md).
 *
 * Immutable once OPEN: `payload` and `versionHash` are written by the Persister and never
 * edited; feedback produces a successor card (`revisedFromCardId`). Every status change is
 * a conditional UPDATE (`… WHERE status = :from`) in PmAgentCardRepository.transition and
 * writes a pm_agent_card_events row. CHECK constraints on the enums and the unique index
 * on `builderSessionId` live in migration 1982000000000.
 */
@Entity('pm_agent_cards')
@Index('idx_pm_agent_cards_status', ['status'])
@Index('idx_pm_agent_cards_run', ['runId'])
@Index('idx_pm_agent_cards_hash', ['versionHash'])
export class PmAgentCard extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind!: PmCardKind;

  @Column({ type: 'varchar', length: 24 })
  category!: PmCardCategory;

  @Column({ type: 'varchar', length: 24, default: PmCardStatus.OPEN })
  status!: PmCardStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  /** sha256 of the canonical payload (cardVersionHash); acceptance is bound to it. */
  @Column({ type: 'varchar', length: 64 })
  versionHash!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** The versioned card payload (schemaVersion 1). See dto/pm-card-payload.dto.ts. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;

  /** Ranker score; higher first. */
  @Column({ type: 'double precision', default: 0 })
  rank!: number;

  /** fetchedAt of the oldest evidence item the card cites. */
  @Column({ type: 'timestamptz', nullable: true })
  evidenceFreshness?: Date | null;

  /** Stable key of a question, for the 14-day skip suppression. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  questionKey?: string | null;

  @Column({ type: 'uuid', nullable: true })
  revisedFromCardId?: string | null;

  /** When the card first became OPEN — decision latency is measured from here. */
  @Column({ type: 'timestamptz', nullable: true })
  openedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  acceptPath?: PmAcceptPath | null;

  @Column({ type: 'timestamptz', nullable: true })
  undoUntil?: Date | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reasonChip?: PmRejectReasonChip | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /** Plain-language reason a person is needed (failed build, reviewer finding…). */
  @Column({ type: 'text', nullable: true })
  needsYouReason?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  needsYouDismissedAt?: Date | null;

  /** A skipped question is not re-asked before this. */
  @Column({ type: 'timestamptz', nullable: true })
  suppressUntil?: Date | null;

  /** The deterministic compiled PRD as sent to Builder, and its hash. */
  @Column({ type: 'jsonb', nullable: true })
  compiledPrd?: Record<string, any> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  compiledPrdHash?: string | null;

  @Column({ type: 'uuid', nullable: true })
  builderSessionId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  roadmapOpportunityId?: string | null;
}
