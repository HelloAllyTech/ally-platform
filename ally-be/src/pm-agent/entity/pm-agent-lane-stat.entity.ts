import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PmLaneStatDimension } from '../enum/pm-agent.enum';

/**
 * Per-category / lane / source counters for selection learning (plan §9b loop 3). Written
 * by deterministic code on every decision and outcome; `decayedScore` is recomputed by the
 * pipeline (min 8 decisions before weights move, exploration floor). UNIQUE (dimension, key).
 */
@Entity('pm_agent_lane_stats')
export class PmAgentLaneStat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  dimension!: PmLaneStatDimension;

  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'int', default: 0 })
  shown!: number;

  @Column({ type: 'int', default: 0 })
  accepted!: number;

  @Column({ type: 'int', default: 0 })
  rejected!: number;

  @Column({ type: 'int', default: 0 })
  feedback!: number;

  @Column({ type: 'int', default: 0 })
  shipped!: number;

  @Column({ type: 'int', default: 0 })
  failed!: number;

  @Column({ type: 'double precision', nullable: true })
  decayedScore?: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  costUsd!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
