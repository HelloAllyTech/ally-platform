import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface ManualChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** Manual pages the answer drew on. */
  citations?: { slug: string; title: string }[];
  /** Pages the agent edited while answering, with the revision to revert. */
  edits?: { slug: string; title: string; revisionId: string; reason: string }[];
}

export interface ManualChatDraft {
  id: string;
  title: string;
  text: string;
  relatedPages: { slug: string; title: string }[];
  /** Set once saved to the user's roadmap drafts. */
  savedCode?: string | null;
  discarded?: boolean;
}

/** A user's chat with the manual: the messages and the drafts tray, both kept as JSON. */
@Entity('manual_conversations')
export class ManualConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_manual_conversations_user')
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 200, default: 'New chat' })
  title!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages!: ManualChatMessage[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  drafts!: ManualChatDraft[];

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
