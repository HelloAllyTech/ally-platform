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

/** An approval waiting for the person's "yes" (on the agent message that asked). */
export interface PmPlan {
  id: string;
  tool: string;
  ideaId: string | null;
  args: Record<string, unknown>;
  text: string;
  label: string;
  /** The person who was asked; their next message is the only yes that counts. */
  askedUserId: number | null;
  at: string;
  usedAt?: string | null;
}

/**
 * The Debrief console's one PM agent conversation (V2_AUTONOMY C1–C3,
 * migration 1981901650000): a single shared thread, oldest first. A person's
 * message records what it was about and every action its turn took
 * (`actions`, written by the gateway); the agent's reply carries the action it
 * took (`action`) and, while an approval waits for a yes, the `plan`.
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
