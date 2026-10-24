import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { GuideTriggerStatus } from '../enum/guide.enum';

/**
 * A platform event waiting to be folded into a turn (plan §7.8): item
 * completed, quiz graded, roleplay ended, debrief ready… `dedupeKey` (e.g.
 * `item_completed:<progressId>`) makes at-least-once delivery safe.
 */
@Entity('guide_triggers')
export class GuideTrigger extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  threadId!: string;

  @Column({ type: 'varchar', length: 48 })
  kind!: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  dedupeKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, any>;

  @Column({ type: 'varchar', length: 12, default: GuideTriggerStatus.PENDING })
  status!: GuideTriggerStatus;

  @Column({ type: 'timestamp', nullable: true })
  runAfter?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  consumedByTurnId?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;
}
