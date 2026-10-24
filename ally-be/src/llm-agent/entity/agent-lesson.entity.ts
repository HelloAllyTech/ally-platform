import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentReleaseAuthorKind } from '../harness/enum/harness.enum';
import {
  AGENT_LESSON_KINDS,
  AgentLessonScope,
  AgentLessonStatus,
} from '../harness/enum/learning.enum';

/** What a curator change does. */
export type AgentLessonKind = (typeof AGENT_LESSON_KINDS)[number];

/**
 * One change the curator proposed (plans/ally-guide/plan.md §7.13 loop 2):
 * a lesson for the playbook, or a policy or prompt tweak. Every change the
 * curator ever wrote is kept here — blocked, quarantined and rejected ones
 * included — so a person can see what the loop tried and why it was refused.
 *
 * `text` is the curator's own words, checked against learner transcripts
 * before it is stored as anything but BLOCKED. `evidence` holds counts and
 * ids, never a learner's words.
 */
@Entity('agent_lessons')
@Index('idx_agent_lessons_agent_status', ['agentKey', 'status'])
@Index('idx_agent_lessons_release', ['releaseId'])
export class AgentLesson extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'varchar', length: 12, default: 'lesson' })
  kind!: AgentLessonKind;

  @Column({ type: 'varchar', length: 12 })
  scope!: AgentLessonScope;

  /** The organisation an ORG lesson applies to. */
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  /** The course a COURSE lesson applies to. */
  @Column({ type: 'uuid', nullable: true })
  trackId?: string | null;

  @Column({ type: 'varchar', length: 12, default: AgentLessonStatus.PROPOSED })
  status!: AgentLessonStatus;

  /** The lesson as the agent will read it; for a tweak, a one-line summary. */
  @Column({ type: 'varchar', length: 400 })
  text!: string;

  /** A policy tweak `{key, from, to}` or a prompt tweak `{role, find, replace}`. */
  @Column({ type: 'jsonb', nullable: true })
  change?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  rationale?: string | null;

  /** Counts and ids only: learners, tenants, criteria, evaluation ids. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  evidence!: Record<string, any>;

  /** Why a guardrail refused it, or quarantined it (machine-readable). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  blockReason?: string | null;

  /** The release that carries (or carried) it. */
  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  /** sha256 of kind + scope + text + change: one proposal per idea. */
  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({ type: 'varchar', length: 16 })
  authorKind!: AgentReleaseAuthorKind;

  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt?: Date | null;
}
