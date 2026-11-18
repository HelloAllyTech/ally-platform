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

  /**
   * The safety pack it was built with (chunk 20a onboarding), or null. The engine adds the pack's
   * rules to every run, and a settings change that weakens it is refused.
   */
  @Column({ name: 'safety_pack', type: 'varchar', length: 32, nullable: true })
  safetyPack?: string | null;

  @Column({ name: 'safety_pack_version', type: 'int', nullable: true })
  safetyPackVersion?: number | null;

  /** The owner's own rules, on top of the pack: lines the assistant must never cross. */
  @Column({ type: 'jsonb', default: () => `'{"never":[]}'` })
  rules!: { never: string[]; avoid?: string[] };

  /**
   * What it's for (chunk 20a-2): answer, enquiries, training, guide or custom; null for bots made
   * before purposes, which run exactly as before. Adds a short section to the agent's instructions
   * after the owner's and before the safety rules.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  purpose?: string | null;

  /** "Something else": the owner's own description of what it's for. */
  @Column({ name: 'purpose_note', type: 'text', nullable: true })
  purposeNote?: string | null;

  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt?: Date | null;
}
