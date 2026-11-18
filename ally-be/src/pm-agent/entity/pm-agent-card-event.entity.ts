import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Append-only audit of every card transition and action (who, when, which version). */
@Entity('pm_agent_card_events')
@Index('idx_pm_agent_card_events_card', ['cardId', 'createdAt'])
export class PmAgentCardEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cardId!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  fromStatus?: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  toStatus?: string | null;

  @Column({ type: 'int' })
  cardVersion!: number;

  /** null = the system (worker, reconcile, circuit breaker). */
  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
