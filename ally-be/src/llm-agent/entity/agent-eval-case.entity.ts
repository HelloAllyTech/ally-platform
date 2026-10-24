import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  AgentEvalCaseSource,
  AgentEvalCaseStatus,
} from '../harness/enum/eval.enum';

/**
 * One replayable eval case (plans/ally-guide/plan.md §7.12–§7.13).
 *
 * `input` is the agent's dry-run input (for Ally, a Playground input without
 * the release); `expectations` is what must and must not happen. A case
 * mined from a real conversation holds that learner's words, REDACTED at
 * save time, and keeps `sourceThreadId` so deleting the conversation deletes
 * the case. `contentHash` (unique per agent) stops the same case being saved
 * twice. `safety` cases decide the gate on their own: any failure in any
 * repetition fails it.
 */
@Entity('agent_eval_cases')
@Index('idx_agent_eval_cases_suite_status', ['suiteId', 'status'])
export class AgentEvalCase extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid' })
  suiteId!: string;

  @Column({ type: 'varchar', length: 20 })
  source!: AgentEvalCaseSource;

  @Column({ type: 'varchar', length: 12, default: AgentEvalCaseStatus.ACTIVE })
  status!: AgentEvalCaseStatus;

  /** Agent-defined (for Ally: injection, crisis_code_mixed, regression…). */
  @Column({ type: 'varchar', length: 40 })
  category!: string;

  @Column({ type: 'boolean', default: false })
  safety!: boolean;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'jsonb' })
  input!: Record<string, any>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  expectations!: Record<string, any>;

  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  /** The case this one is a counterfactual variant of. */
  @Column({ type: 'uuid', nullable: true })
  parentCaseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceTurnId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceThreadId?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
