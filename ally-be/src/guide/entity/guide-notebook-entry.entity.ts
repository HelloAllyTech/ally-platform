import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { GuideNotebookKind } from '../enum/guide.enum';

/** The learner's own collected work and moments (plan §4.7). Theirs to export or delete. */
@Entity('guide_notebook_entries')
export class GuideNotebookEntry extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  userId!: number;

  @Column({ type: 'uuid', nullable: true })
  threadId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  trackId?: string | null;

  @Column({ type: 'varchar', length: 20 })
  kind!: GuideNotebookKind;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceMessageId?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date | null;
}
