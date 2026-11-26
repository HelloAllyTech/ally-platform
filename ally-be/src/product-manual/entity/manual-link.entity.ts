import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** `[[slug]]` cross-links found in a page body; rebuilt on every write. Backlinks read `to_slug`. */
@Entity('manual_links')
export class ManualLink {
  @PrimaryColumn({ name: 'from_slug', type: 'varchar', length: 120 })
  fromSlug!: string;

  @Index('idx_manual_links_to')
  @PrimaryColumn({ name: 'to_slug', type: 'varchar', length: 120 })
  toSlug!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
