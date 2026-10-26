import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Where a version came from; recorded so the history says who proposed what. */
export enum PromptVersionSource {
  DASHBOARD = 'dashboard',
  CLI = 'cli',
  SYNC = 'sync',
  REVERT = 'revert',
  EXPERIMENT = 'experiment',
  BUILDER = 'builder',
  IMPORT = 'import',
  DUPLICATE = 'duplicate',
  MIGRATION = 'migration',
}

/**
 * One immutable version of a prompt: the English body plus the model settings
 * it runs with. Never edited after it is written.
 *
 * `prompts.currentVersion` points at the live version. A version newer than it
 * that has no `publishedAt` is a candidate: it exists, is translated and can be
 * tested, but nothing serves it until it is promoted.
 */
@Entity('prompts_versions')
@Index('uq_prompts_versions_idx', ['promptId', 'version'], { unique: true })
@Index('prompts_versions_promptId_idx', ['promptId'])
export class PromptVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  promptId!: string;

  @Column()
  version!: number;

  @Column()
  prompt!: string;

  @Column()
  createdBy?: number;

  @Column()
  updatedBy?: number;

  /** Provider this version runs on; null = infer from the model. */
  @Column({ type: 'varchar', nullable: true })
  provider?: string | null;

  /** Model this version runs on; null = the call site's default. */
  @Column({ type: 'varchar', nullable: true })
  model?: string | null;

  @Column({
    type: 'numeric',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | null) =>
        value === null || value === undefined ? null : parseFloat(value),
    },
  })
  temperature?: number | null;

  /** sha256 of the trimmed body; what sessions record as the text that ran. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  contentHash?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  source?: PromptVersionSource | null;

  /** Why this version exists (a push message, an experiment's label). */
  @Column({ type: 'text', nullable: true })
  note?: string | null;

  /** Eval or v2v results attached when the version was proposed. */
  @Column({ type: 'jsonb', nullable: true })
  evalSummary?: Record<string, unknown> | null;

  /** When this version first went live; null for a candidate. */
  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;
}
