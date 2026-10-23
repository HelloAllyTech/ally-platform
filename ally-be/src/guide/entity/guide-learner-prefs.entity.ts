import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** The learner layer of Ally's config (plan §5.7, §7.5). Validated in the service. */
export interface GuideLearnerPrefsValue {
  guidance?: 'lead' | 'walk' | 'drive';
  voiceEnabled?: boolean;
  turnMode?: 'hands_free' | 'push_to_talk';
  sideQuests?: boolean;
  challenge?: 'normal' | 'more';
  memoryEnabled?: boolean;
  outreach?: 'off' | 'in_app' | 'in_app_email';
  preferClassic?: boolean;
  languageCode?: string | null;
}

/** One row per (user, org). Missing row = every default. */
@Entity('guide_learner_prefs')
export class GuideLearnerPrefs extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  @PrimaryColumn({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  prefs!: GuideLearnerPrefsValue;
}
