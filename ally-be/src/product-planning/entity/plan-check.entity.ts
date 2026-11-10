import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlanCheckStatus = 'running' | 'findings' | 'resolved' | 'failed';

export interface PlanCheckFinding {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  mitigation?: string;
  resolution?: {
    kind: 'fixed' | 'dismissed';
    reason: string;
    by: number;
    at: string;
  } | null;
}

/**
 * One review-board check on one plan: safety, privacy or AI quality
 * (rev 5.2 §B.8.4). Which checks a plan needs is code (requiredChecks over its
 * impact tags); what they find is a cold reviewer's; resolving them is the
 * lead's, with a written reason — there is no human sign-off role.
 *
 * `factsHash` is the PRD and design the check judged; when either changes the
 * check is stale and runs again. `mode = 'shadow'` while a reviewer is new:
 * its findings are shown but do not block readiness.
 */
@Entity('plan_checks')
@Index('uq_plan_checks_session_kind', ['sessionId', 'kind'], { unique: true })
export class PlanCheck {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: 'safety' | 'privacy' | 'ai_quality';

  @Column({ type: 'varchar', length: 16 })
  status!: PlanCheckStatus;

  @Column({ type: 'varchar', length: 8, default: 'live' })
  mode!: 'shadow' | 'live';

  @Column({ type: 'jsonb', default: () => "'[]'" })
  findings!: PlanCheckFinding[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  factsHash?: string | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
