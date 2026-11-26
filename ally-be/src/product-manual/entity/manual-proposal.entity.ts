import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ManualProposalKind = 'edit' | 'new_page' | 'gap';
export type ManualProposalSource = 'coding_agent' | 'chat';
export type ManualProposalStatus = 'open' | 'applied' | 'dismissed';

/**
 * A note that the manual needs to change. Coding agents file these during a PR through the
 * proposal-scoped MCP key; the chat agent files a `gap` when it cannot answer. They never edit the
 * manual themselves (chat edits live and is logged); the weekly agent reads the open ones and applies
 * them as revisions.
 */
@Entity('manual_proposals')
export class ManualProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: ManualProposalKind;

  @Index('idx_manual_proposals_page')
  @Column({ name: 'page_slug', type: 'varchar', length: 120, nullable: true })
  pageSlug?: string | null;

  /** What should change, in a sentence. */
  @Column({ type: 'text' })
  summary!: string;

  /** Anything the weekly agent needs: what the code now does, the endpoint, the UI label. */
  @Column({ type: 'text', default: '' })
  detail!: string;

  @Column({ name: 'pr_ref', type: 'varchar', length: 200, nullable: true })
  prRef?: string | null;

  @Column({ type: 'varchar', length: 16 })
  source!: ManualProposalSource;

  @Column({ name: 'key_id', type: 'uuid', nullable: true })
  keyId?: string | null;

  @Column({ name: 'submitted_by', type: 'int', nullable: true })
  submittedBy?: number | null;

  @Index('idx_manual_proposals_status')
  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: ManualProposalStatus;

  @Column({ name: 'applied_revision_id', type: 'uuid', nullable: true })
  appliedRevisionId?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
