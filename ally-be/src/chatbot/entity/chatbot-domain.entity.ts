import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum ChatbotDomainStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  FAILED = 'failed',
}

/** One step of the last DNS check, as the Channels screen explains it. */
export interface DomainStepResult {
  /** `ok`: found and right. `missing`: no record yet. `wrong`: a record, pointing elsewhere. */
  state: 'ok' | 'missing' | 'wrong' | 'error';
  /** What DNS answered, for "we found X, it should be Y". */
  found: string[];
}

export interface DomainCheckResult {
  cname: DomainStepResult;
  txt: DomainStepResult;
}

/**
 * An owner's own domain for the bot page (stage 7), e.g. `chat.sunrisemind.in`. The owner adds a
 * CNAME to Ally's bot-page host and a TXT record `_ally-verify.<host>` with the token; a live check
 * sets `status`. Certificates and the proxy are infrastructure (docs/custom-domains.md). The
 * default `/chat/<id>` address always keeps working. `host` is unique ignoring case
 * (`uq_chatbot_domains_host`, migration 1987600000000).
 */
@Entity('chatbot_domains')
export class ChatbotDomain {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 253 })
  host!: string;

  @Column({ type: 'varchar', length: 64, name: 'verification_token' })
  verificationToken!: string;

  @Column({ type: 'varchar', length: 16, default: ChatbotDomainStatus.PENDING })
  status!: ChatbotDomainStatus;

  @Column({ type: 'jsonb', name: 'last_check', nullable: true })
  lastCheck!: DomainCheckResult | null;

  @Column({ type: 'timestamptz', name: 'checked_at', nullable: true })
  checkedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'int', name: 'created_by', nullable: true })
  createdBy!: number | null;

  @Column({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt!: Date;
}
