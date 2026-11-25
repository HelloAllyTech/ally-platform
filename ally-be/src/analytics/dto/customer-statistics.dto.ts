import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { CustomerReason } from '../constants/customer-health.constants';

/** One organisation on the Customers tab. Aggregates only. */
export interface CustomerOrgRow {
  tenantId: string;
  name: string;
  code: string | null;
  learners: number;
  activeLearners28d: number;
  completedLast28d: number;
  completedPrev28d: number;
  lastCompletedAt: string | null;
  daysSinceLastCompleted: number | null;
  /** Completed sessions per ISO week, on the shared axis of `trendBuckets`. */
  trend: number[];
  creditUtilisationPct: number | null;
  /** Null under the learner floor, where a rate would be about named people. */
  ratingsAverage90d: number | null;
  ratingsCount90d: number;
  reviewSharePercent: number | null;
  neverStartedLearners: number;
  belowFloor: boolean;
  reasons: CustomerReason[];
  /** How much the attention reasons add up to; 0 when there are none. */
  score: number;
  contactedAt: string | null;
  contactNote: string | null;
  /** Contacted recently enough that it is not asking for another message yet. */
  recentlyContacted: boolean;
}

export interface CustomerMover {
  tenantId: string;
  name: string;
  from: number;
  to: number;
}

export interface CustomerOverview {
  generatedAt: string;
  trendBuckets: string[];
  summary: {
    orgs: number;
    activeOrgs: number;
    quietOrgs: number;
    needsOutreach: number;
  };
  /** Ranked: those asking for a message first, those contacted recently last. */
  orgs: CustomerOrgRow[];
  movers: { up: CustomerMover[]; down: CustomerMover[] };
}

export class CustomerOutreachBodyDto {
  @ApiProperty({ description: 'The organisation that was contacted' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'A short note of your own. Never about a learner.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
