import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { UseCaseTemplate } from '../../chatbot/templates/templates';

export type AssistantTemplateStatus = 'draft' | 'published' | 'retired';

/**
 * One version of a use-case template that Ally staff manage (Assistants admin → Templates).
 * See the migration for the lifecycle: draft → published → retired, one published and one draft
 * per key at a time.
 */
@Entity('assistant_templates')
@Unique('UQ_assistant_templates_key_version', ['templateKey', 'version'])
export class AssistantTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 40 })
  templateKey!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: AssistantTemplateStatus;

  /** The whole template, as `UseCaseTemplate` (its `id` equals `templateKey`). */
  @Column({ type: 'jsonb' })
  manifest!: UseCaseTemplate;

  /** What changed, in the editor's words; shown in the version history. */
  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'published_by', type: 'int', nullable: true })
  publishedBy?: number | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt?: Date | null;
}
