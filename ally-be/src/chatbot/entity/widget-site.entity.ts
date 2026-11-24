import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A site the website widget has loaded on (stage 7). The widget may load on any site, so the
 * owner sees where it has been. Written at most once an hour per site (Redis gate), so
 * `loadCount` is approximate: loads counted in Redis between writes are added at the next write.
 */
@Entity('widget_sites')
@Index('uq_widget_sites_chatbot_host', ['chatbotId', 'host'], { unique: true })
export class WidgetSite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  /** The page's hostname as the browser reported it (`Origin`), lower case, no port. */
  @Column({ type: 'varchar', length: 253 })
  host!: string;

  @Column({ type: 'timestamptz', name: 'first_seen' })
  firstSeen!: Date;

  @Column({ type: 'timestamptz', name: 'last_seen' })
  lastSeen!: Date;

  @Column({ type: 'int', name: 'load_count', default: 0 })
  loadCount!: number;
}
