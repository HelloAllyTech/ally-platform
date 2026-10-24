import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { AgentEvalSuiteKind } from '../harness/enum/eval.enum';

/**
 * A named set of eval cases for one agent (plans/ally-guide/plan.md §7.13).
 * `(agentKey, key)` is unique, so code can find a suite by a stable key
 * (`smoke`, `regression`, `red_team`) whatever its id.
 */
@Entity('agent_eval_suites')
export class AgentEvalSuite extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: AgentEvalSuiteKind;

  @Column({ type: 'text', nullable: true })
  description?: string | null;
}
