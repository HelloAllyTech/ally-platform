import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  PmMemoryKind,
  PmMemorySource,
  PmQuestionScope,
} from '../enum/pm-agent.enum';

/**
 * A typed, provenance-tracked memory fact (or a lesson). Data, never instructions:
 * lanes retrieve the top-k relevant ones and fence them. Admin-editable.
 */
@Entity('pm_agent_memory')
@Index('idx_pm_agent_memory_active', ['kind', 'active'])
@Index('idx_pm_agent_memory_key', ['key'])
export class PmAgentMemory extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, default: PmMemoryKind.FACT })
  kind!: PmMemoryKind;

  @Column({ type: 'varchar', length: 160 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'varchar', length: 16, default: PmQuestionScope.GLOBAL })
  scope!: PmQuestionScope;

  @Column({ type: 'varchar', length: 16 })
  source!: PmMemorySource;

  @Column({ type: 'uuid', nullable: true })
  sourceCardId?: string | null;

  /** 0–1; null when a person stated it. */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence?: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  supersedesId?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
