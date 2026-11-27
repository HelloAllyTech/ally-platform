import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ManualAuthorKind =
  | 'seed'
  | 'weekly_agent'
  | 'chat_agent'
  | 'proposal'
  | 'human'
  | 'revert';

/** A pointer to where a claim came from, e.g. { kind: 'code', repo: 'ally-be', path: 'src/…' }. */
export interface ManualSourceRef {
  kind: 'code' | 'wiki' | 'pr' | 'analytics' | 'chat';
  label: string;
  repo?: string;
  path?: string;
  url?: string;
}

/**
 * One stored version of a page: the full text after a change, who or what made it, and why. The
 * change log is this table read newest first; a revert writes a new row (author 'revert') that
 * copies an older one, so history is never rewritten.
 */
@Entity('manual_revisions')
export class ManualRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_manual_revisions_page')
  @Column({ name: 'page_id', type: 'uuid' })
  pageId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  summary!: string;

  @Column({ type: 'text', default: '' })
  body!: string;

  @Column({ name: 'author_kind', type: 'varchar', length: 16 })
  authorKind!: ManualAuthorKind;

  /** user id, agent run id, proposal id … whatever identifies the author. */
  @Column({ name: 'author_ref', type: 'varchar', length: 120, nullable: true })
  authorRef?: string | null;

  /** Why, in one sentence a reader of the change log can follow. */
  @Column({ type: 'text', default: '' })
  reason!: string;

  @Column({ name: 'source_refs', type: 'jsonb', default: () => "'[]'" })
  sourceRefs!: ManualSourceRef[];

  @Column({ name: 'revert_of', type: 'uuid', nullable: true })
  revertOf?: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
