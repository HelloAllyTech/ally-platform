import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** What a rule does: guide Builder when it would ask, or decide in the person's place. */
export type BuilderRuleEffect = 'guide' | 'decide';

/**
 * The fixed list of areas a rule can be scoped to. Fixed on purpose: free-text
 * areas fragment ("admin", "Admin UI", "admin dashboard") and a rule nobody can
 * find in the right group is a rule that is never applied.
 */
export const BUILDER_RULE_AREAS = [
  'Admin UI',
  'Helpline UI',
  'Learner experience',
  'Mobile',
  'ally-be API',
  'Data model',
  'AI prompts',
] as const;
export type BuilderRuleArea = (typeof BUILDER_RULE_AREAS)[number];

/**
 * For `decide` rules: which decisions it answers, and with which option.
 * `questionType` narrows interview questions; absent means any of that kind.
 */
export interface BuilderRuleMatch {
  kind: string;
  questionType?: string | null;
  optionId: string;
}

/**
 * Something the person decided once that binds future work — the product's
 * taste written down. Guide rules are read by the interview and by every run;
 * decide rules answer matching decisions themselves (surface `rule` in
 * History), and only while the autonomy level allows it.
 *
 * Append-only by supersession: editing a rule writes a new row pointing at the
 * old one (`supersedesId`) and switches the old one off, so History can always
 * say which wording was in force when a rule decided something. `active` is
 * the only column that changes after insert.
 *
 * How often a rule was applied is not stored: it is the count of History rows
 * carrying its id.
 */
@Entity('builder_rules')
@Index('idx_builder_rules_active', ['active'])
export class BuilderRule extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** One sentence, written for a person and read by the model. */
  @Column({ type: 'text' })
  statement!: string;

  /** `everywhere`, `area:<name>`, `session:<id>` or `opportunity:<id>`. */
  @Column({ type: 'varchar', length: 120 })
  scope!: string;

  /** The group the Rules page shows it under: an area, or "Everywhere". */
  @Column({ type: 'varchar', length: 40 })
  area!: string;

  @Column({ type: 'varchar', length: 8, default: 'guide' })
  effect!: BuilderRuleEffect;

  @Column({ type: 'jsonb', nullable: true })
  match?: BuilderRuleMatch | null;

  /** The History answer it was made from, if any. */
  @Column({ type: 'uuid', nullable: true })
  sourceHistoryId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  supersedesId?: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
