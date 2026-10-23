import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentReleaseAuthorKind,
  AgentReleaseStatus,
} from '../harness/enum/harness.enum';

/**
 * An immutable, versioned bundle of everything that decides an agent's
 * behaviour — prompts, model routing, capabilities, skills, policy values and
 * the playbook (plans/ally-guide/plan.md §7.4). Never edited after it leaves
 * DRAFT: a change is a new version. Exactly one GA release per agent
 * (partial unique index `uq_agent_releases_one_ga`).
 */
@Entity('agent_releases')
@Index('idx_agent_releases_agent_status', ['agentKey', 'status'])
export class AgentRelease extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', length: 16, default: AgentReleaseStatus.DRAFT })
  status!: AgentReleaseStatus;

  /** The bundle itself; shape owned by the agent (e.g. GuideReleaseBundle). */
  @Column({ type: 'jsonb' })
  bundle!: Record<string, any>;

  /** sha256 of the canonical bundle JSON — equal hashes mean equal behaviour. */
  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({ type: 'uuid', nullable: true })
  parentReleaseId?: string | null;

  @Column({ type: 'int', nullable: true })
  rolloutPercent?: number | null;

  @Column({ type: 'varchar', length: 16 })
  authorKind!: AgentReleaseAuthorKind;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'uuid', nullable: true })
  evalRunId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  shadowReportId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  promotedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  retiredAt?: Date | null;
}
