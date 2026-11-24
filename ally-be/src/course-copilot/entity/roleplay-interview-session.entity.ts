import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  RoleplayInterviewBrief,
  RoleplayInterviewPlan,
  RoleplayInterviewStatus,
} from '../roleplay-interview/type/roleplay-interview.type';

/**
 * One roleplay interview (Studio's Agent Builder Copilot chat). Private to its
 * creator. `planVersion` is the optimistic-concurrency check for approval.
 *
 * Lives in `course-copilot/entity/` rather than beside the rest of the
 * roleplay interview because the data source loads entities from
 * `dist/<module>/entity/` only.
 */
@Entity('roleplay_interview_sessions')
@Index('idx_roleplay_interview_sessions_created_by', ['createdBy'])
export class RoleplayInterviewSession extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'int', nullable: true })
  scenarioId?: number | null;

  @Column({
    type: 'varchar',
    default: RoleplayInterviewStatus.INTERVIEWING,
  })
  status!: RoleplayInterviewStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  brief!: RoleplayInterviewBrief;

  @Column({ type: 'jsonb', nullable: true })
  plan?: RoleplayInterviewPlan | null;

  @Column({ type: 'int', default: 0 })
  planVersion!: number;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date | null;
}
