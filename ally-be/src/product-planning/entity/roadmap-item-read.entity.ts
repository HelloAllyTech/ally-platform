import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * When one person last looked at one idea: the queue's unread dots (§5.2).
 * Written by the idea page (P2); read against the idea's last activity.
 */
@Entity('roadmap_item_reads')
export class RoadmapItemRead {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  @PrimaryColumn({ type: 'uuid' })
  itemId!: string;

  @Column({ type: 'timestamptz' })
  lastSeenAt!: Date;
}
