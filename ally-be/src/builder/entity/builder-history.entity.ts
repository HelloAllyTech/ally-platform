import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** What a history row records. */
export type BuilderHistoryEntryType =
  /** A decision answered: from Now, a session page, Slack, or by a rule. */
  | 'decision'
  /** A read-only question to a session (Phase 2). */
  | 'ask'
  /** An instruction to a session, queued until a run applies it (Phase 2). */
  | 'tell'
  /** An opportunity handed to Builder from Up next. */
  | 'start'
  /** An untouched interview cancelled and its opportunity returned to the roadmap. */
  | 'putback';

export const BUILDER_HISTORY_ENTRY_TYPES: BuilderHistoryEntryType[] = [
  'decision',
  'ask',
  'tell',
  'start',
  'putback',
];

/** Where the person was when they decided. `rule` means nobody was. */
export type BuilderHistorySurface = 'now' | 'session' | 'slack' | 'rule';

/** Client-reported from breakpoint and pointer, so phone answers can be told apart. */
export type BuilderHistoryClient = 'phone' | 'tablet' | 'desktop';

/** A Tell's lifecycle: written queued, stamped applied by the run that read it. */
export type BuilderTellStatus = 'queued' | 'applied' | 'cancelled';

/**
 * Builder's History: every decision, ask and tell, append-only.
 *
 * A decision itself is never stored (builder-decision.type.ts explains why);
 * this is the record of what was *done* with one, written at the point of
 * effect. It freezes what the card looked like when it was answered — the
 * prompt, the label chosen, which option was recommended — because the
 * session the decision came from moves on, and a scoreboard that re-derived
 * "did the person agree with the recommendation" from today's state would be
 * answering a different question.
 *
 * Rows are corrected by writing new ones, never edited, with two exceptions
 * that are part of a row's own lifecycle rather than a correction: `undoneAt`
 * (the person took a reversible answer back inside its window) and the apply
 * fields (`appliedAt` / `applyError`, `tellStatus` / `appliedRunId`).
 *
 * No FK to builder_sessions, like builder_lessons: what was decided outlives
 * the session.
 */
@Entity('builder_history')
@Index('idx_builder_history_session', ['sessionId'])
@Index('idx_builder_history_decided_at', ['decidedAt'])
@Index('idx_builder_history_decision', ['decisionId'])
export class BuilderHistoryEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  entryType!: BuilderHistoryEntryType;

  /** The feed id (`kind:sessionId[:ref]`), for decision rows. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  decisionId?: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  kind?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  category?: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  questionType?: string | null;

  /** Null only for an ask about all work. */
  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  /** Frozen, so History still reads after the session is renamed or archived. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sessionTitle?: string | null;

  @Column({ type: 'uuid', nullable: true })
  pullRequestId?: string | null;

  /** What was asked: the decision's prompt, the ask's question, the tell's instruction. */
  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'jsonb', nullable: true })
  chosenOptionIds?: string[] | null;

  /** The chosen option's label (or labels), frozen at the time. */
  @Column({ type: 'text', nullable: true })
  chosenLabel?: string | null;

  @Column({ type: 'text', nullable: true })
  customText?: string | null;

  /** Builder's reply to an ask. */
  @Column({ type: 'text', nullable: true })
  answerText?: string | null;

  /** Frozen before the answer is applied: what the card recommended. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  recommendedOptionId?: string | null;

  /**
   * Whether the person took the recommendation. Null when there was none to
   * take, or when the decision had one option (agreeing with the only choice
   * is not agreement).
   */
  @Column({ type: 'boolean', nullable: true })
  matchedRecommendation?: boolean | null;

  /** The chosen option could not be taken back (a merge, a stopped build). */
  @Column({ type: 'boolean', default: false })
  oneWay!: boolean;

  /** The rule that decided this, or that was applied in its place. */
  @Column({ type: 'uuid', nullable: true })
  ruleId?: string | null;

  @Column({ type: 'varchar', length: 12 })
  surface!: BuilderHistorySurface;

  @Column({ type: 'varchar', length: 8, nullable: true })
  client?: BuilderHistoryClient | null;

  /** Null when a rule decided, or when the answer came from Slack (a Slack id is not an Ally user). */
  @Column({ type: 'int', nullable: true })
  actorUserId?: number | null;

  /** When Builder started waiting. */
  @Column({ type: 'timestamp', nullable: true })
  raisedAt?: Date | null;

  @Column({ type: 'timestamp' })
  decidedAt!: Date;

  @Column({ type: 'int', nullable: true })
  waitSeconds?: number | null;

  /** Client-reported: from the card taking focus to the answer being sent. */
  @Column({ type: 'int', nullable: true })
  msToDecide?: number | null;

  /** Set when a reversible answer was taken back inside its undo window. Undone rows count in no metric. */
  @Column({ type: 'timestamp', nullable: true })
  undoneAt?: Date | null;

  /** When the answer actually reached the session (after the undo window, for a reversible one). */
  @Column({ type: 'timestamp', nullable: true })
  appliedAt?: Date | null;

  /** Why a deferred answer could not be applied when its window closed. */
  @Column({ type: 'text', nullable: true })
  applyError?: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  tellStatus?: BuilderTellStatus | null;

  @Column({ type: 'uuid', nullable: true })
  appliedRunId?: string | null;
}
