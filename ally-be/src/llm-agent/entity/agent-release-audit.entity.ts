import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  AgentReleaseAuditAction,
  AgentReleaseAuthorKind,
} from '../harness/enum/harness.enum';

/** Append-only record of every release action (plan §7.4). Never updated. */
@Entity('agent_release_audit')
@Index('idx_agent_release_audit_agent_created', ['agentKey', 'createdAt'])
export class AgentReleaseAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  releaseId!: string;

  @Column({ type: 'varchar', length: 32 })
  action!: AgentReleaseAuditAction;

  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  @Column({ type: 'varchar', length: 16 })
  actorKind!: AgentReleaseAuthorKind;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, any> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
