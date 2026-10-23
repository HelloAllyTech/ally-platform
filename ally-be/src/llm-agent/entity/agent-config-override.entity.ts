import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentConfigLayer } from '../harness/enum/harness.enum';

/**
 * Org- or course-layer policy overrides, resolved over the release defaults
 * (plan §7.5). `scopeId` is the tenant id for the org layer and the track id
 * for the course layer. Only keys the policy schema marks overridable by that
 * layer are honoured; the rest are ignored by the resolver.
 */
@Entity('agent_config_overrides')
export class AgentConfigOverride extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'varchar', length: 16 })
  layer!: AgentConfigLayer;

  @Column({ type: 'varchar', length: 64 })
  scopeId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  values!: Record<string, unknown>;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
