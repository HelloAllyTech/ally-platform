import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { GuideMemoryKind, GuideMemoryStatus } from '../enum/guide.enum';

/**
 * Something Ally remembers about a learner, per (user, org) (plan §2.2 D4).
 * The learner can view, edit and delete each note. A deleted note becomes a
 * tombstone (`status = deleted`, `bodyHash` kept) so the curator never writes
 * the same thing back. A note the curator retired as out of date
 * (`status = retired`) loses its text too, but may be written again. Never
 * holds third-party identifying details.
 */
@Entity('guide_learner_memories')
@Index('idx_guide_learner_memories_owner', ['userId', 'tenantId', 'status'])
export class GuideLearnerMemory extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 24 })
  kind!: GuideMemoryKind;

  @Column({ type: 'varchar', length: 280 })
  body!: string;

  @Column({ type: 'varchar', length: 64 })
  bodyHash!: string;

  @Column({ type: 'varchar', length: 12, default: GuideMemoryStatus.ACTIVE })
  status!: GuideMemoryStatus;

  @Column({ type: 'uuid', nullable: true })
  sourceThreadId?: string | null;

  /**
   * The learner messages the note was drawn from (memory provenance): the
   * learner sees them as "why Ally remembers this". Null on older notes.
   */
  @Column({ type: 'jsonb', nullable: true })
  sourceMessageIds?: string[] | null;

  @Column({ type: 'real', nullable: true })
  confidence?: number | null;

  /** Optimistic revision: a curator write must name the revision it read. */
  @Column({ type: 'int', default: 1 })
  revision!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastConfirmedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;
}
