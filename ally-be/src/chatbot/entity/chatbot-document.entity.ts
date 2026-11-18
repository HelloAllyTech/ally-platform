import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A library document a bot answers from. Documents stay in the shared library, so editing one
 * updates every bot that uses it.
 */
@Entity('chatbot_documents')
@Index('uq_chatbot_documents_bot_doc', ['chatbotId', 'documentId'], {
  unique: true,
})
export class ChatbotDocument extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Index('idx_chatbot_documents_document')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
