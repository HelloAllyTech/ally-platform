import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

/** Where one gateway call is: claimed before the tool runs, then recorded (chunk 3b). */
export enum ToolRunStatus {
  STARTED = 'started',
  OK = 'ok',
  ERROR = 'error',
}

/**
 * One call an agent run made through the tool gateway (chunk 3b). Unique on run id and step: a
 * redelivered message derives the same run id, so its replayed call finds this row and gets the
 * stored outcome instead of acting twice. Inputs can hold what people said: erasure and the
 * retention sweep delete these rows, and logs never carry them.
 */
@Entity('tool_runs')
@Unique('UQ_tool_runs_run_step', ['runId', 'step'])
@Index('idx_tool_runs_conversation', ['conversationId'])
@Index('idx_tool_runs_created', ['createdAt'])
export class ToolRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  /** Text, not a uuid: Preview's `preview-…` ids aren't stored conversations. */
  @Column({ name: 'conversation_id', type: 'text' })
  conversationId!: string;

  @Column({ name: 'run_id', type: 'text' })
  runId!: string;

  /** The call's index in its run (0–3). */
  @Column({ type: 'int' })
  step!: number;

  @Column({ type: 'varchar', length: 64 })
  tool!: string;

  @Column({ type: 'jsonb', default: {} })
  input!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  status!: ToolRunStatus;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode?: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null;
}
