import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** A crisis or wellbeing line shown to learners (plan §6.3). */
export interface GuideSupportLine {
  name: string;
  phone: string;
  hours?: string | null;
  url?: string | null;
  isCrisis?: boolean;
}

/** The org layer, edited by the Ally team (plan §2.1 decision 17). */
export interface GuideOrgProfileValue {
  /** Keyed by language code; `en` is the fallback. */
  supportLines?: Record<string, GuideSupportLine[]>;
  supervisorContact?: string | null;
  supervisorWording?: string | null;
  protocols?: string | null;
  toneNotes?: string | null;
  avoidTopics?: string[];
  outreachEnabled?: boolean;
  emailEnabled?: boolean;
}

@Entity('guide_org_profiles')
export class GuideOrgProfile extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', unique: true })
  tenantId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  profile!: GuideOrgProfileValue;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
