import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

export type SessionBookmarkSource = 'web' | 'mobile';

/**
 * A learner saved one of their roleplay sessions to come back to, with an
 * optional note to themselves. One bookmark per learner per session.
 */
@Entity('session_bookmarks')
@Unique('uq_session_bookmarks_user_session', ['userId', 'sessionId'])
export class SessionBookmark extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_session_bookmarks_user')
  @Column({ type: 'int' })
  userId!: number;

  /** `scenario_sessions.id`; no foreign key, so a deleted session leaves history intact. */
  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 280, nullable: true })
  note!: string | null;

  /** Where the learner saved it from. */
  @Column({ type: 'varchar', length: 8, default: 'web' })
  source!: SessionBookmarkSource;
}
