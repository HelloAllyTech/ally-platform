import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentChannel } from 'src/llm-agent/harness/enum/harness.enum';
import { GuideMessageKind, GuideMessageRole } from '../enum/guide.enum';

/** Per-message safety flags (plan §6.1–§6.2). Flagged text never reaches memory. */
export interface GuideMessageFlags {
  realCase?: boolean;
  pii?: boolean;
  crisis?: boolean;
  care?: boolean;
}

/**
 * The Ally transcript. `content` is what the learner sees; `renderedContent`
 * and `providerBlocks` are exactly what the model saw (including thinking
 * signatures) and are replayed byte for byte, so they are written once by the
 * turn that produced them and never updated (plan §7.1 principle 6).
 */
@Entity('guide_messages')
@Index('UQ_guide_messages_thread_seq', ['threadId', 'seq'], { unique: true })
export class GuideMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 16 })
  role!: GuideMessageRole;

  @Column({ type: 'varchar', length: 8, default: AgentChannel.TEXT })
  channel!: AgentChannel;

  @Column({ type: 'varchar', length: 16, default: GuideMessageKind.CHAT })
  kind!: GuideMessageKind;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  renderedContent?: Record<string, any>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  providerBlocks?: Record<string, any>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  @Column({ type: 'uuid', nullable: true })
  turnId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  clientTurnId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  flags?: GuideMessageFlags | null;

  @Column({ type: 'text', nullable: true })
  redactedContent?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
