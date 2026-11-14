import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

export enum MemorySection {
  PREFERENCES = 'preferences',
  CONTEXT = 'context',
  OPEN_ITEMS = 'open_items',
}

export enum MemorySourceKind {
  /** The assistant wrote it from what the person said. */
  PERSON = 'person',
  /** An editor changed its text in the Inbox. */
  OWNER = 'owner',
}

export enum MemoryStatus {
  ACTIVE = 'active',
  DONE = 'done',
  FORGOTTEN = 'forgotten',
}

/**
 * One line an assistant remembers about one contact (Agents v2, chunk 8a), with the person message
 * it came from. Shown to the agent as "What you know about this person" (4a: `USER.md`) and to the
 * owner in the Inbox. Derived data: erasure, Forget this person and the retention sweep delete it.
 * Written only by `MemoryService`, after a reply has been sent.
 */
@Entity('memory_entries')
@Index('idx_memory_entries_person', ['chatbotId', 'contactId', 'status'])
@Index('idx_memory_entries_expires', ['expiresAt'])
@Index('idx_memory_entries_said', ['saidAt'])
export class MemoryEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ type: 'varchar', length: 16 })
  section!: MemorySection;

  /** At most 200 characters, never blank. */
  @Column({ type: 'varchar', length: 200 })
  text!: string;

  /** The person message it came from; null once that message is deleted. */
  @Column({ name: 'source_message_id', type: 'uuid', nullable: true })
  sourceMessageId?: string | null;

  @Column({
    name: 'source_kind',
    type: 'varchar',
    length: 8,
    default: MemorySourceKind.PERSON,
  })
  sourceKind!: MemorySourceKind;

  /** The run that wrote or last renewed it. */
  @Column({ name: 'run_id', type: 'text', nullable: true })
  runId?: string | null;

  @Column({ type: 'varchar', length: 12, default: MemoryStatus.ACTIVE })
  status!: MemoryStatus;

  /** When the person last said it: retention counts from here, and saying it again renews it. */
  @Column({ name: 'said_at', type: 'timestamp' })
  saidAt!: Date;

  /** Null: kept until retention (or for good, with retention off). */
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date | null;
}
