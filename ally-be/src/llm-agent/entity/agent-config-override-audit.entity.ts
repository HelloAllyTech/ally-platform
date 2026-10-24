import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AgentConfigLayer } from '../harness/enum/harness.enum';

/**
 * Append-only record of every change to an org- or course-layer override
 * (plan §7.5): one row per key changed — who, when, the value before and the
 * value after (null on either side = not set). Never updated.
 */
@Entity('agent_config_override_audit')
@Index('idx_agent_config_override_audit_scope', [
  'agentKey',
  'layer',
  'scopeId',
  'createdAt',
])
export class AgentConfigOverrideAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'varchar', length: 16 })
  layer!: AgentConfigLayer;

  @Column({ type: 'varchar', length: 64 })
  scopeId!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  /** `{ value }` before the change, or null when the key was not set. */
  @Column({ type: 'jsonb', nullable: true })
  oldValue?: { value: unknown } | null;

  /** `{ value }` after the change, or null when it was cleared. */
  @Column({ type: 'jsonb', nullable: true })
  newValue?: { value: unknown } | null;

  /** The override row's version after this change. */
  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
