import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SkillsStoreKeyScope {
  /** Read live and candidate versions (`prompts pull`). */
  PULL = 'pull',
  /** Create candidate versions (`prompts push`). Never promotes. */
  PUSH = 'push',
}

/**
 * A key generated in the Skills Store for the `prompts` CLI. Anyone with Skills
 * Store access can create one, hand it to a teammate or contractor, and revoke
 * it. Only a sha256 of the key is stored; the plain key is shown once.
 */
@Entity('skills_store_keys')
@Index('uq_skills_store_keys_hash', ['keyHash'], { unique: true })
export class SkillsStoreKey extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** First characters of the key, shown in the list so a key can be recognised. */
  @Column({ type: 'varchar', length: 16 })
  prefix!: string;

  @Column({ type: 'varchar', length: 64 })
  keyHash!: string;

  @Column({ type: 'jsonb', default: () => `'["pull"]'` })
  scopes!: SkillsStoreKeyScope[];

  @Column({ type: 'integer', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  revokedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date | null;
}
