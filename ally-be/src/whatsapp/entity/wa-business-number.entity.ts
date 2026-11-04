import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  WaBusinessNumberSource,
  WaBusinessNumberStatus,
} from '../enum/whatsapp.enum';

/**
 * One organisation's own WhatsApp Business number.
 *
 * Until this table the bot was a single platform number configured in env vars, answering anyone
 * whose organisation it could resolve. An organisation that wants its workers to message *its own*
 * number — its name in the chat header, its helplines in the crisis reply — connects it here, and
 * every message to that number is answered from that organisation's documents only.
 *
 * The env-configured number still works and is deliberately NOT a row here: it is the platform's,
 * belongs to no organisation, and a missing row must never take it down.
 *
 * Secrets are encrypted at rest (`WhatsAppCredentialCipherService`) and never returned by the API.
 * `appSecretEnc` is set only for a MANUAL number, whose webhooks Meta signs with the organisation's
 * own app secret; an Embedded Signup number lives on Ally's app and is signed with the env secret.
 */
@Entity('wa_business_numbers')
export class WaBusinessNumber extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The organisation that connected the number, if any. Informational since chatbots: which bot
   * answers is decided by the connector, and Ally's own numbers belong to no organisation.
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId?: string | null;

  /** The connector this number is the WhatsApp store of. */
  @Index('uq_wa_business_numbers_connector', ['connectorId'], {
    unique: true,
    where: '"deletedAt" IS NULL',
  })
  @Column({ type: 'uuid', name: 'connector_id', nullable: true })
  connectorId?: string | null;

  /**
   * Meta's id for the number, and the routing key on the shared webhook. Unique among live rows:
   * two organisations claiming one number would make every inbound message ambiguous.
   */
  @Index('uq_wa_business_numbers_phone_number_id', ['phoneNumberId'], {
    unique: true,
    where: '"deletedAt" IS NULL',
  })
  @Column({ type: 'varchar', length: 64, name: 'phone_number_id' })
  phoneNumberId!: string;

  @Column({ type: 'varchar', length: 64, name: 'waba_id' })
  wabaId!: string;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'display_phone_number',
    nullable: true,
  })
  displayPhoneNumber?: string | null;

  @Column({ type: 'text', name: 'verified_name', nullable: true })
  verifiedName?: string | null;

  @Column({ type: 'text', name: 'access_token_enc' })
  accessTokenEnc!: string;

  @Column({ type: 'text', name: 'app_secret_enc', nullable: true })
  appSecretEnc?: string | null;

  /**
   * The unguessable path segment of this number's own webhook URL. A MANUAL number's Meta app is
   * the organisation's, configured by them, so it gets a URL of its own — that is what tells us
   * which app secret to check the signature with before anything in the body is trusted.
   */
  @Index('uq_wa_business_numbers_webhook_key', ['webhookKey'], {
    unique: true,
    where: '"deletedAt" IS NULL',
  })
  @Column({ type: 'varchar', length: 64, name: 'webhook_key' })
  webhookKey!: string;

  /** Shown to the admin to paste into Meta, so it is stored readable rather than encrypted. */
  @Column({ type: 'varchar', length: 64, name: 'verify_token' })
  verifyToken!: string;

  @Column({ type: 'varchar', length: 24 })
  source!: WaBusinessNumberSource;

  @Column({ type: 'varchar', length: 24 })
  status!: WaBusinessNumberStatus;

  @Column({ type: 'timestamp', name: 'last_checked_at', nullable: true })
  lastCheckedAt?: Date | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
