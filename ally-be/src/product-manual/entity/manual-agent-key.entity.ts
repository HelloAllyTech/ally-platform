import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A key a coding agent uses to file manual proposals through the proposal-scoped MCP endpoint. It
 * can read the manual and file proposals; it cannot edit a page. Only the sha256 hash is stored; the
 * plaintext (`pmk_…`) is shown once at creation. Modelled on `cl_reader_keys`.
 */
@Entity('manual_agent_keys')
export class ManualAgentKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId!: number;

  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Index('uq_manual_agent_keys_hash', { unique: true })
  @Column({ name: 'key_hash', type: 'varchar', length: 64 })
  keyHash!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 12 })
  keyPrefix!: string;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
