import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('sscenario_session_behavior_instructions_scenario_session_id_idx', [
  'scenarioSessionId',
])
@Entity('scenario_session_behavior_instructions')
export class ScenarioSessionBehaviorInstructions extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  scenarioBehaviorInstructionId!: string;

  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  /**
   * The points this detection added, frozen when it happened, so editing the
   * instruction's score later does not re-score past sessions. NULL on rows
   * recorded before the column existed: those fall back to the category's
   * default (+10 / -10), which is what they were scored with.
   */
  @Column({ type: 'int', nullable: true })
  score?: number | null;
}
