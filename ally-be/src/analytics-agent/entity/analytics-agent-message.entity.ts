import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** A reader's rating of one answer. Absent (null) when they gave none. */
export type AnalyticsAgentFeedback = 'up' | 'down';

/**
 * One turn of a saved conversation: the question and the agent's whole reply.
 *
 * A turn is a single row rather than a user row plus an agent row. A question
 * is only saved once the agent has replied, so the two can never exist apart,
 * and keeping them together means a reopened thread renders exactly what the
 * reader saw — answer, caveats, chart spec, rows, SQL, follow-ups — without
 * re-running anything.
 *
 * `response` is the `AskAnalyticsAgentResponseDto` as it was returned, stored
 * as a snapshot. Numbers in it are as of the time asked, which is the point: a
 * reopened answer must not silently change under the reader.
 *
 * `outcome` is a plain varchar with no CHECK (and no TypeScript `enum:` on the
 * column), so a future outcome never needs a migration. Only the clients that
 * render it care about the value.
 *
 * `feedback` is the reader's optional thumbs up / down on the answer: null until
 * they give one, and null again if they take it back. Like `outcome` it is a
 * plain varchar with no CHECK.
 *
 * The FK to the conversation is ON DELETE CASCADE and lives in the migration.
 */
@Entity('analytics_agent_messages')
@Index('idx_analytics_agent_messages_conversation_created', [
  'conversationId',
  'createdAt',
])
export class AnalyticsAgentMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  conversationId!: string;

  /** The question exactly as typed. */
  @Column({ type: 'text' })
  question!: string;

  /** What happened to it — `answer`, `clarify`, `refused`, `rejected`, `failed`. */
  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  /** The full response, as returned to the client at the time. */
  @Column({ type: 'jsonb' })
  response!: Record<string, unknown>;

  /** The reader's thumbs up / down on this answer; null = none given. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  feedback!: AnalyticsAgentFeedback | null;
}
