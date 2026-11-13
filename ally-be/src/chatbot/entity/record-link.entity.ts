import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RecordLinkTargetKind } from '../enum/list.enum';

/**
 * One relation value of a record (chunk 5a), indexed both ways: "which bookings point at this
 * slot" is one lookup. Replaced whenever the record is written.
 */
@Entity('record_links')
@Index('idx_record_links_record', ['recordId', 'fieldKey'])
@Index('idx_record_links_target', ['targetKind', 'targetId'])
export class RecordLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;

  @Column({ name: 'field_key', type: 'varchar', length: 40 })
  fieldKey!: string;

  @Column({ name: 'target_kind', type: 'varchar', length: 16 })
  targetKind!: RecordLinkTargetKind;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;
}
