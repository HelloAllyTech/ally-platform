import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EndPersonIdentityKind = 'phone' | 'email';

/**
 * One person a chatbot serves, however they reach it (section 3, "Who counts as a person"): a phone
 * and an email can point at the same person, so per-user limits (and later memory, consent and
 * erase) key on this, not on a channel's own contact row.
 */
@Entity('end_persons')
@Index('idx_end_persons_chatbot', ['chatbotId'])
export class EndPerson {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  display!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

/**
 * A phone (E.164) or an email (lowercase) that is this person on this chatbot. Unique per
 * chatbot: one identity is one person.
 */
@Entity('end_person_identities')
@Index(
  'uq_end_person_identities_chatbot_kind_value',
  ['chatbotId', 'kind', 'value'],
  {
    unique: true,
  },
)
export class EndPersonIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'end_person_id' })
  endPersonId!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: EndPersonIdentityKind;

  @Column({ type: 'varchar', length: 254 })
  value!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
