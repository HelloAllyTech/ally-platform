import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** What a message was about (V2_AUTONOMY API contract `PmAbout`). */
export interface PmAbout {
  kind: 'change' | 'session' | 'page';
  id?: string;
  label: string;
}

/** The action an agent message took (`PmMessage.action`). */
export interface PmAction {
  label: string;
  status: 'done' | 'awaiting_yes' | 'failed';
}

/** One action the gateway carried out (or refused) during a turn. */
export interface PmTurnAction extends PmAction {
  tool: string;
  ideaId?: string | null;
  at: string;
  planId?: string;
}

/** One action the paused turn would carry out. */
export interface PmPlanAction {
  tool: string;
  ideaId: string | null;
  args: Record<string, unknown>;
  label: string;
}

/**
 * The action(s) a conversation thread is paused on, waiting for the asked
 * person's "yes" (on the agent message that asked): ally-ai's LangGraph
 * human-in-the-loop interrupt. The thread's next message resolves it, once.
 */
export interface PmPlan {
  /** The LangGraph interrupt id ally-ai resumes. */
  id: string;
  /** The checkpoint thread it is paused in. */
  threadId: string;
  actions: PmPlanAction[];
  /** The plan in plain words, as the agent stated it. */
  text: string;
  label: string;
  /** The person who was asked; their next message is the only yes that counts. */
  askedUserId: number | null;
  at: string;
  usedAt?: string | null;
  /** How it was resolved: approve (a yes with the permission) or reject. */
  decision?: 'approve' | 'reject' | null;
}

/**
 * The Debrief console's one PM agent conversation (V2_AUTONOMY C1–C3,
 * migration 1981901650000): a single shared thread, oldest first. A person's
 * message records what it was about and every action its turn took
 * (`actions`, written by the gateway); the agent's reply carries the action it
 * took (`action`) and, while the thread is paused for a yes, the `plan`
 * (the interrupt ally-ai resumes).
 */
@Entity('debrief_pm_messages')
export class DebriefPmMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  who!: 'person' | 'agent';

  @Column({ type: 'int', nullable: true })
  authorUserId?: number | null;

  /** The person's name when they wrote it, so the shared thread shows who decided. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  authorName?: string | null;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'jsonb', nullable: true })
  about?: PmAbout | null;

  @Column({ type: 'jsonb', nullable: true })
  action?: PmAction | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  actions!: PmTurnAction[];

  @Column({ type: 'jsonb', nullable: true })
  plan?: PmPlan | null;

  /** On an agent message: the person's message it answers (the turn id). */
  @Column({ type: 'uuid', nullable: true })
  replyTo?: string | null;

  /** On an agent message: finished / budget_spent / failed. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  status?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;
}
