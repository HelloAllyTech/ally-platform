import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AgentReleaseAuthorKind } from '../harness/enum/harness.enum';
import { AgentLessonAuditAction } from '../harness/enum/learning.enum';

/**
 * The curator's append-only audit (plans/ally-guide/plan.md §7.13): every
 * proposal, block, quarantine, approval and activation, every curator run,
 * every delegation stage change and every step the pipeline took on its own.
 * Release status changes are in `agent_release_audit`; the two together are
 * the complete trail. Never updated.
 */
@Entity('agent_lesson_audit')
@Index('idx_agent_lesson_audit_agent_created', ['agentKey', 'createdAt'])
export class AgentLessonAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid', nullable: true })
  lessonId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'varchar', length: 24 })
  action!: AgentLessonAuditAction;

  @Column({ type: 'varchar', length: 16 })
  actorKind!: AgentReleaseAuthorKind;

  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, any> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
