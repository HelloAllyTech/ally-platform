import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** What a learner did with a debrief (v9 FR-48, §3.3). */
export const DEBRIEF_LEARNER_EVENT_KINDS = [
  'opened',
  'read_through',
  'listened',
  'practise_next_click',
  'reflection_answered',
  'replied',
  'waited',
  'left_before_ready',
  // The post-launch pulse (PRD §9): one answer per question, yes or no.
  'pulse_knew_next_yes',
  'pulse_knew_next_no',
  'pulse_fair_yes',
  'pulse_fair_no',
] as const;
export type DebriefLearnerEventKind =
  (typeof DEBRIEF_LEARNER_EVENT_KINDS)[number];

/** The kinds only the app can see; the rest are recorded by ally-be itself. */
export const DEBRIEF_CLIENT_EVENT_KINDS = [
  'read_through',
  'practise_next_click',
  'waited',
  'left_before_ready',
] as const satisfies readonly DebriefLearnerEventKind[];

/** The pulse's two questions (PRD §9): "Did you know what to practise next?" and "Did this feel fair?". */
export const DEBRIEF_PULSE_QUESTIONS = ['knew_next', 'fair'] as const;
export type DebriefPulseQuestion = (typeof DEBRIEF_PULSE_QUESTIONS)[number];

export const DEBRIEF_PLATFORMS = ['web', 'ios', 'android'] as const;
export type DebriefPlatform = (typeof DEBRIEF_PLATFORMS)[number];

/**
 * One thing a learner did with one session's debrief (migration
 * 1981002300000): once per session, learner and kind, so metrics count
 * debriefs rather than taps. Never any text the learner wrote.
 */
@Entity('debrief_learner_events')
export class DebriefLearnerEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 32 })
  kind!: DebriefLearnerEventKind;

  @Column({ type: 'varchar', length: 10, nullable: true })
  platform?: DebriefPlatform | null;
}
