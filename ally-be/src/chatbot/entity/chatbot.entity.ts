import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotStatus,
} from '../enum/chatbot.enum';
import type {
  ChatbotModelChoice,
  ChatbotPersona,
  ChatbotSettingsOverride,
} from '../type/chatbot.type';

/**
 * A configurable bot. Not tied to an organisation: it is reached through the connectors bound to it
 * (a WhatsApp number today), answers from the documents picked for it, and is managed by its
 * members.
 */
@Entity('chatbots')
export class Chatbot extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 16, default: ChatbotStatus.DRAFT })
  status!: ChatbotStatus;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'access_mode',
    default: ChatbotAccessMode.LISTED,
  })
  accessMode!: ChatbotAccessMode;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'answer_mode',
    default: ChatbotAnswerMode.DOCUMENTS_ONLY,
  })
  answerMode!: ChatbotAnswerMode;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'knowledge_source',
    default: ChatbotKnowledgeSource.SELECTED,
  })
  knowledgeSource!: ChatbotKnowledgeSource;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  persona!: ChatbotPersona;

  /** Null answers with the platform's default model. */
  @Column({ type: 'jsonb', nullable: true })
  model?: ChatbotModelChoice | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings!: ChatbotSettingsOverride;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;

  /** When it was last tried in Preview (which stores no messages). */
  @Column({ type: 'timestamp', name: 'last_tested_at', nullable: true })
  lastTestedAt?: Date | null;

  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt?: Date | null;
}
