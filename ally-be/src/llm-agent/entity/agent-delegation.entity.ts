import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * How much of the learning loop runs without a person, per agent
 * (plans/ally-guide/plan.md §7.13 progressive delegation):
 *
 *  1. the curator proposes only;
 *  2. gate, shadow and canary run on their own, a person promotes;
 *  3. promotion is automatic too.
 *
 * Auto-revert is on at every stage. A person raises the stage one step at a
 * time, only when that stage's preconditions hold, and may lower it at any
 * time; it drops on its own when its preconditions stop holding. Every
 * change is in `agent_lesson_audit`. No row means stage 1.
 */
@Entity('agent_delegation')
export class AgentDelegation {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'smallint', default: 1 })
  stage!: number;

  @Column({ type: 'int', nullable: true })
  changedBy?: number | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  changedAt!: Date;
}
