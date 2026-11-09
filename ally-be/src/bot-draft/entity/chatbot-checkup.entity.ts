import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  CheckupExpect,
  CheckupOutcome,
  CheckupSource,
} from '../../ai/dto/checkup.dto';

export type CheckupOrigin = 'generated' | 'owner' | 'platform' | 'suite';
export type CheckupTrigger = 'onboarding' | 'manual' | 'after_change' | 'eval';
export type CheckupResultVerdict = 'pass' | 'fail' | 'needs_input' | 'error';

/**
 * One checkup question for an assistant (chunk 20a-2), with what a good reply must do.
 *
 * Every question has a source: a page, a document, the owner's answer, the safety pack or the
 * platform's fixed set. `platform` questions (the pack's safety probes) can't be removed, edited
 * or paused. A regenerate replaces only `generated` questions the owner hasn't confirmed.
 * `suite` questions come from an eval suite file (the Sunrise baseline), keyed by its own ids.
 */
@Entity('chatbot_checkup_cases')
@Index('idx_chatbot_checkup_cases_chatbot', ['chatbotId', 'status', 'position'])
export class ChatbotCheckupCase extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 500 })
  question!: string;

  @Column({ type: 'varchar', length: 16 })
  expect!: CheckupExpect;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  facts!: string[];

  @Column({ name: 'must_not', type: 'jsonb', default: () => "'[]'" })
  mustNot!: string[];

  @Column({ name: 'also_ok', type: 'jsonb', default: () => "'[]'" })
  alsoOk!: string[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  source!: CheckupSource;

  @Column({ type: 'varchar', length: 16 })
  origin!: CheckupOrigin;

  @Column({ type: 'boolean', default: false })
  confirmed!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: 'active' | 'paused';

  @Column({ name: 'hard_fail', type: 'boolean', default: false })
  hardFail!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'must_pass' })
  tier!: 'must_pass' | 'nice_to_pass';

  /** Questions sharing a thread run in order, in one conversation. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  thread?: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  suite?: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
  externalId?: string | null;

  @Column({ name: 'pack_id', type: 'varchar', length: 32, nullable: true })
  packId?: string | null;

  @Column({ name: 'pack_version', type: 'int', nullable: true })
  packVersion?: number | null;

  @Column({ type: 'int', default: 0 })
  generation!: number;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}

/** One run of an assistant's checkup questions through its own engine. */
@Entity('chatbot_checkup_runs')
@Index('idx_chatbot_checkup_runs_chatbot', ['chatbotId', 'startedAt'])
export class ChatbotCheckupRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ name: 'draft_id', type: 'uuid', nullable: true })
  draftId?: string | null;

  @Column({ type: 'varchar', length: 16 })
  trigger!: CheckupTrigger;

  /** Set when the run asked only one suite's questions (an eval). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  suite?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status!: 'running' | 'done' | 'failed';

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'int', default: 0 })
  done!: number;

  /** The run's measures, from `CheckupStatsService`, written when it finishes. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  totals!: Record<string, unknown>;

  @Column({ name: 'started_by', type: 'int', nullable: true })
  startedBy?: number | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}

/** One question's graded result in a run (an eval asks each question more than once). */
@Entity('chatbot_checkup_results')
@Index('idx_chatbot_checkup_results_run', ['runId'])
export class ChatbotCheckupResult extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId!: string;

  @Column({ type: 'int', default: 1 })
  attempt!: number;

  @Column({ type: 'text', default: '' })
  reply!: string;

  @Column({ name: 'handled_by', type: 'varchar', length: 32, default: '' })
  handledBy!: string;

  @Column({ type: 'varchar', length: 16 })
  outcome!: CheckupOutcome;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations!: { documentId: string; title: string; url: string }[];

  @Column({ type: 'varchar', length: 16 })
  verdict!: CheckupResultVerdict;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  reasons!: string[];

  @Column({ name: 'hard_fail', type: 'boolean', default: false })
  hardFail!: boolean;

  @Column({ name: 'wrong_decline', type: 'boolean', default: false })
  wrongDecline!: boolean;

  @Column({ name: 'answer_page_offered', type: 'boolean', nullable: true })
  answerPageOffered?: boolean | null;

  @Column({ type: 'int', nullable: true })
  searches?: number | null;

  @Column({ name: 'grader_version', type: 'varchar', length: 32, default: '' })
  graderVersion!: string;

  @Column({ type: 'int', default: 0 })
  ms!: number;
}
