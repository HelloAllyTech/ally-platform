import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * An anonymous visitor on a guided course link (plan §3 stages 1–3). Only a
 * hash of the visitor token is stored; the token itself lives in the browser.
 * Claimed (user + tenant attached) when the visitor signs in. Unclaimed rows
 * are purged after 30 days (Appendix A).
 */
@Entity('guide_visitors')
export class GuideVisitor extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipHash?: string | null;

  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'int', nullable: true })
  claimedByUserId?: number | null;

  @Column({ type: 'varchar', nullable: true })
  claimedTenantId?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt?: Date | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  lastSeenAt!: Date;
}
