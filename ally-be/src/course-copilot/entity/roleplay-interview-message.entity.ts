import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RoleplayInterviewMessageRole } from '../roleplay-interview/type/roleplay-interview.type';

/**
 * Append-only roleplay interview transcript, replayed into the model each
 * turn (text + tool_use + tool_result rebuilt from the jsonb columns). `seq`
 * is unique per session and is what `done {messageSeq}` reports.
 */
@Entity('roleplay_interview_messages')
@Index('idx_roleplay_interview_messages_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
export class RoleplayInterviewMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar' })
  role!: RoleplayInterviewMessageRole;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /** [{ id, name, input }] */
  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  /** [{ toolUseId, name, result }] */
  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  /**
   * Assistant: provider, model, iterations, stopReason, errored, errorMessage,
   * questions[], plan, receipt, workingNotes, rejections.
   * User: questionId, answer, displayText (what the trainer saw themselves say).
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
