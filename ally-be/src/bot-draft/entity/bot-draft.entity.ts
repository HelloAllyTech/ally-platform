import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  BotDraftStatus,
  BotDraftStep,
  Industry,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import type {
  BotDraft as BotDraftConfig,
  CrawlState,
  DraftEvent,
  Learned,
  TranscriptEntry,
} from '../type/bot-draft.type';

/**
 * One onboarding session (chunk 20a): everything the owner and the builder have put together so
 * far, until it is published as a chatbot. ally-be owns all of it; the builder in ally-ai only
 * proposes patches to `draftConfig` and `learned`, which `BotDraftService` validates and applies.
 */
@Entity('bot_drafts')
@Index('idx_bot_drafts_owner', ['ownerUserId', 'status', 'updatedAt'])
export class BotDraftEntity extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_user_id', type: 'int' })
  ownerUserId!: number;

  /** The owner's own organisation, for "People in your organisation" and the daily cap. */
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 16, default: BotDraftStatus.ACTIVE })
  status!: BotDraftStatus;

  @Column({ type: 'varchar', length: 16, default: BotDraftStep.START })
  step!: BotDraftStep;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  source!: {
    website?: string;
    uploads?: string[];
    description?: string;
    /** The "Owner notes" document publish wrote, so publishing again updates it. */
    ownerNotesDocumentId?: string | null;
  };

  @Column({
    type: 'jsonb',
    default: () =>
      `'{"status":"idle","queue":[],"seen":[],"pages":[],"findings":[]}'`,
  })
  crawl!: CrawlState;

  @Column({ type: 'jsonb', default: () => `'{"facts":[],"dropped":0}'` })
  learned!: Learned;

  @Column({ type: 'varchar', length: 32, nullable: true })
  industry?: Industry | null;

  @Column({ name: 'safety_pack', type: 'varchar', length: 32, nullable: true })
  safetyPack?: SafetyPackId | null;

  @Column({ name: 'safety_pack_version', type: 'int', nullable: true })
  safetyPackVersion?: number | null;

  /** The owner's answers to the builder's questions, keyed by what was asked. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  answers!: Record<string, unknown>;

  /** The designs offered and the one chosen. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  design!: Record<string, unknown>;

  @Column({ name: 'draft_config', type: 'jsonb' })
  draftConfig!: BotDraftConfig;

  @Column({ name: 'chatbot_id', type: 'uuid', nullable: true })
  chatbotId?: string | null;

  /** The builder chat, so a return visit picks up where it left off. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  transcript!: TranscriptEntry[];

  /** Append-only: every change, with how to undo it. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  events!: DraftEvent[];

  /** Bumped on every write; an edit made on an older version is refused (409). */
  @Column({ type: 'int', default: 0 })
  version!: number;
}
