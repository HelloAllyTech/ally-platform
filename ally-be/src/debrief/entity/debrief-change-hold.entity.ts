import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A hold on Debrief changes (migration 1981901650000):
 *
 * - `language` (V2_AUTONOMY A9): sessions in `language` run on `releaseId`
 *   instead of the release in force. `held` / `undone`: a change kept away
 *   from that language (the release before it); `only`: a change live only for
 *   the languages it names (its release, while everyone else stays on the
 *   release in force). One active pin per language; lifted, never deleted.
 * - `pause` (C2): no change of `changeKind` (prompts / settings / code) is
 *   tried or handed over until `until`.
 */
@Entity('debrief_change_holds')
export class DebriefChangeHold extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 12 })
  kind!: 'language' | 'pause';

  @Column({ type: 'varchar', length: 10, nullable: true })
  language?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  changeKind?: string | null;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  ideaId?: string | null;

  @Column({ type: 'varchar', length: 12 })
  reason!: 'held' | 'undone' | 'only' | 'paused';

  @Column({ type: 'timestamp', nullable: true })
  until?: Date | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  liftedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  liftedBy?: number | null;
}
