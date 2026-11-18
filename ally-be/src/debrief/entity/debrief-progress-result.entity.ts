import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One skill's reading after the code vetoes. */
export interface DebriefProgressSkill {
  skill: string;
  trend:
    | 'more_consistent'
    | 'about_the_same'
    | 'worth_another_look'
    | 'too_early';
  why?: string;
  evidence?: Array<{ run_id: string; turn_index: number | null }>;
  fhs?: 'agrees' | 'disagrees' | 'absent';
  learner_line?: string | null;
  /** worth_another_look kept for staff, its line blanked for the learner. */
  hidden_from_learner?: boolean;
}

export interface DebriefProgressVeto {
  skill: string;
  veto: string;
  detail?: string | null;
}

/**
 * One learner-progress reading of one Debrief agent run (migration
 * 1981901100000): the progress agent's report after the code vetoes, and
 * whether the learner got a line or the card. Append-only: written once when
 * the graph's answer is applied, read back as the next run's "last progress
 * report" and by the Console's session view. Deleted with its run and session.
 */
@Entity('debrief_progress_results')
@Index('debrief_progress_results_learner_idx', [
  'counselorId',
  'tenantId',
  'createdAt',
])
export class DebriefProgressResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'counselor_id', type: 'int' })
  counselorId!: number;

  @Index('debrief_progress_results_run_idx')
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'scenario_session_id', type: 'uuid' })
  scenarioSessionId!: string;

  /** The past sessions the reading looked back over, newest first. */
  @Column({
    name: 'window_session_ids',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  windowSessionIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  skills!: DebriefProgressSkill[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  followups!: Array<Record<string, any>>;

  @Column({ type: 'jsonb', nullable: true })
  focus?: Record<string, any> | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  vetoes!: DebriefProgressVeto[];

  /** `line` (the short line in the debrief) or `card` ("Your last n sessions"). */
  @Column({ name: 'shown_as', type: 'varchar', length: 8 })
  shownAs!: 'line' | 'card';

  /** The Analyst prompt versions the evidence spans. */
  @Column({
    name: 'analyst_versions',
    type: 'int',
    array: true,
    default: () => "'{}'",
  })
  analystVersions!: number[];

  @Column({ type: 'varchar', nullable: true })
  model?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
