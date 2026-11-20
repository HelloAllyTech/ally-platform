import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A use-case template installed on an assistant (Agents v2, T1): where it came from, the owner's
 * setup answers, the lists it added and the ones it left as they were.
 */
@Entity('chatbot_template_installs')
@Index('idx_chatbot_template_installs_chatbot', ['chatbotId', 'installedAt'])
export class ChatbotTemplateInstall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ name: 'template_id', type: 'varchar', length: 40 })
  templateId!: string;

  @Column({ name: 'setup_answers', type: 'jsonb', default: () => "'{}'" })
  setupAnswers!: Record<string, unknown>;

  /** The list keys it added. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  added!: string[];

  /** The list keys the assistant already had, left as they were. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  skipped!: string[];

  @Column({ name: 'installed_by', type: 'int', nullable: true })
  installedBy?: number | null;

  @Column({ name: 'installed_at', type: 'timestamptz', default: () => 'now()' })
  installedAt!: Date;
}
