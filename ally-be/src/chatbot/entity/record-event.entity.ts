import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RecordEventOp } from '../enum/list.enum';
import type { RecordActorRef } from './collection-record.entity';

/** One change to a record (chunk 5a), for audit and, later, Undo and "Why?". */
@Entity('record_events')
@Index('idx_record_events_record', ['recordId', 'createdAt'])
export class RecordEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;

  @Column({ type: 'varchar', length: 16 })
  op!: RecordEventOp;

  @Column({ type: 'jsonb', nullable: true })
  before?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: {} })
  actor!: RecordActorRef;

  @Column({ name: 'run_id', type: 'text', nullable: true })
  runId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
