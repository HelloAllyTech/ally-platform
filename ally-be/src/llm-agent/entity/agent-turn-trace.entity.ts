import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The product-level trace of one turn (plan §7.12): what an admin's Turn
 * Inspector reads. `summary` holds stage timings, the release, the situation
 * report, guard verdicts, tool calls and usage; the full rendered prompt and
 * tool payloads go to S3 under `payloadKey` so this row stays small.
 */
@Entity('agent_turn_traces')
@Index('idx_agent_turn_traces_thread_created', ['threadId', 'createdAt'])
export class AgentTurnTrace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  turnId!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, any>;

  @Column({ type: 'varchar', length: 512, nullable: true })
  payloadKey?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
