import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AUDIT_AGENT_LIMITS } from '../constants/analytics-agent.constants';
import type {
  AnalyticsAuditResult,
  AnalyticsAuditStatus,
  AnalyticsAuditTrigger,
} from '../entity/analytics-agent-audit.entity';

export class StartAnalyticsAuditDto {
  @ApiPropertyOptional({
    description:
      'How many of the most recent answered messages to consider. Messages an ' +
      'earlier audit already covered are skipped, so fewer may actually be audited.',
    default: AUDIT_AGENT_LIMITS.DEFAULT_MESSAGE_COUNT,
    minimum: 1,
    maximum: AUDIT_AGENT_LIMITS.MAX_MESSAGE_COUNT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AUDIT_AGENT_LIMITS.MAX_MESSAGE_COUNT)
  messageCount?: number;
}

/** One audit run as listed in the history sidebar. */
export class AnalyticsAuditSummaryDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: 'When the run started (ISO 8601).' })
  ranAt!: string;

  @ApiProperty({ enum: ['running', 'completed', 'failed'] })
  status!: AnalyticsAuditStatus;

  @ApiProperty({
    enum: ['manual', 'scheduled'],
    description:
      'What started the run: someone pressing Start, or the scheduler.',
  })
  trigger!: AnalyticsAuditTrigger;

  @ApiProperty({ description: 'How many messages the run set out to audit.' })
  totalMessages!: number;

  @ApiProperty({
    description:
      'How many have an entry so far. Reaches totalMessages when the run completes.',
  })
  completedMessages!: number;

  @ApiProperty({
    description:
      'Entries per verdict. `error` counts messages the auditor failed on.',
    example: { correct: 9, incorrect: 2, error: 1 },
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  verdictCounts!: Record<string, number>;
}

export class StartAnalyticsAuditResponseDto {
  @ApiProperty({
    type: AnalyticsAuditSummaryDto,
    nullable: true,
    description:
      'The run that was started, or null when every recent message has already been audited.',
  })
  audit!: AnalyticsAuditSummaryDto | null;
}

export class AnalyticsAuditedMessageDto {
  @ApiProperty() messageId!: string;
  @ApiProperty({ description: 'When the question was asked (ISO 8601).' })
  askedAt!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description:
      'The auditor’s finding: { verdict, summary (markdown), issues[] }. Null when the auditor failed on this message (see `error`).',
  })
  audit!: AnalyticsAuditResult | null;

  @ApiPropertyOptional() error?: string;
}

export class AnalyticsAuditDetailDto extends AnalyticsAuditSummaryDto {
  @ApiProperty({
    type: [AnalyticsAuditedMessageDto],
    description: 'Audited messages so far, in the order they were asked.',
  })
  messages!: AnalyticsAuditedMessageDto[];
}
