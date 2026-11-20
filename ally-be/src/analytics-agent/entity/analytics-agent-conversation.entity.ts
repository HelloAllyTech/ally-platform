import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** Longest title kept — the first question, trimmed to fit a sidebar row. */
export const ANALYTICS_AGENT_CONVERSATION_TITLE_MAX = 120;

/**
 * One saved Analytics Agent conversation: the thread a reader sees in the
 * sidebar of the Analytics → Agent tab.
 *
 * Private to its author. There is no tenant column on purpose — the agent is a
 * platform-scope, super-admin tool, so the isolation boundary here is the
 * *user*, and every read and write filters on `userId`. A conversation is never
 * visible to another admin, whatever their role.
 *
 * The agent itself is still stateless: the client replays prior turns as
 * `history` on each question. This table only remembers the thread so it can be
 * reopened; it is never read back into a prompt by the server.
 *
 * Indexed on (`userId`, `updatedAt`) because the one list query is "my
 * conversations, most recently active first".
 */
@Entity('analytics_agent_conversations')
@Index('idx_analytics_agent_conversations_user_updated', [
  'userId',
  'updatedAt',
])
export class AnalyticsAgentConversation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The author. FK → users ON DELETE CASCADE (declared in the migration). */
  @Column({ type: 'int' })
  userId!: number;

  /** The first question asked, trimmed. Set once; never rewritten. */
  @Column({ type: 'varchar', length: ANALYTICS_AGENT_CONVERSATION_TITLE_MAX })
  title!: string;
}
