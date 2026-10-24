import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The SSE outbox (plan §9.2). Durable events are written here in the same
 * transaction that allocates their `seq`, then fanned out; a reconnecting
 * client replays everything after its `Last-Event-ID`. Kept 30 days.
 */
@Entity('guide_thread_events')
@Index('UQ_guide_thread_events_thread_seq', ['threadId', 'seq'], {
  unique: true,
})
export class GuideThreadEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 32 })
  type!: string;

  /** The full GuideEvent envelope as sent on the wire. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  turnId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
