import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** An entry in a collection. Unique per (collection, entry); removing either side removes the row. */
@Entity('directory_collection_entries')
@Index('uq_directory_collection_entries', ['collectionId', 'entryId'], {
  unique: true,
})
@Index('idx_directory_collection_entries_entry', ['entryId'])
export class DirectoryCollectionEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @Column({ name: 'entry_id', type: 'uuid' })
  entryId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
