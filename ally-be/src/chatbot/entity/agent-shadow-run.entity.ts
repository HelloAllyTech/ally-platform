import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One side of a shadow comparison. Numbers and ids only: never the question or the answer. */
export interface AgentShadowSide {
  intent: string;
  decline_reason: string;
  cited_chunk_ids: string[];
  hit_count: number | null;
  top_similarity: number | null;
  latency_ms: number;
  /** v2 only: how many graph steps the run took. */
  trace_steps?: number;
}

/**
 * One message a shadow bot answered with v1 and then, after the reply had gone out, also ran
 * through the Agents v2 engine, so the two can be compared on live traffic before a switch.
 *
 * Holds no message text on purpose: the conversation already has it, and a comparison table with
 * the questions in it would be a second copy of every question to retain and erase.
 */
@Entity('agent_shadow_runs')
@Index('idx_agent_shadow_runs_chatbot', ['chatbotId', 'createdAt'])
export class AgentShadowRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  /** Unique, so a redelivered message never writes a second comparison. */
  @Index('uq_agent_shadow_runs_inbound', { unique: true })
  @Column({ type: 'uuid', name: 'inbound_message_id' })
  inboundMessageId!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  @Column({ type: 'jsonb' })
  v1!: AgentShadowSide;

  /** Null when the v2 run failed; `error` says why. */
  @Column({ type: 'jsonb', nullable: true })
  v2?: AgentShadowSide | null;

  /** The failure's code or status only, never a message that could echo the request. */
  @Column({ type: 'text', nullable: true })
  error?: string | null;
}
