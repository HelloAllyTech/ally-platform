import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentChannel,
  AgentTurnStatus,
  AgentTurnTrigger,
} from '../harness/enum/harness.enum';

/**
 * One turn of an agent conversation and its state machine (plan §7.3).
 * `(threadId, clientTurnId)` is unique where the client supplied one, which
 * makes a resent request return the existing turn instead of running twice.
 */
@Entity('agent_turns')
@Index('idx_agent_turns_thread_created', ['threadId', 'createdAt'])
export class AgentTurn extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  clientTurnId?: string | null;

  @Column({ type: 'varchar', length: 24 })
  trigger!: AgentTurnTrigger;

  @Column({ type: 'varchar', length: 8, default: AgentChannel.TEXT })
  channel!: AgentChannel;

  @Column({ type: 'varchar', length: 16, default: AgentTurnStatus.RECEIVED })
  status!: AgentTurnStatus;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  arm?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  errorCode?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  ttftMs?: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
