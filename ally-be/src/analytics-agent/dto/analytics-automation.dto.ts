import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AnalyticsAutomationAgentName,
  AnalyticsAutomationAgentStatus,
  AnalyticsAutomationDecision,
  AnalyticsAutomationPrState,
  AnalyticsAutomationReviewVerdict,
} from '../entity/analytics-automation-agent-run.entity';
import type {
  AnalyticsAutomationFindingKind,
  AnalyticsAutomationFindingStatus,
} from '../entity/analytics-automation-finding.entity';
import type {
  AnalyticsAutomationCommitShas,
  AnalyticsAutomationRunStatus,
} from '../entity/analytics-automation-run.entity';

export class AnalyticsAutomationPullRequestDto {
  @ApiProperty({ example: 'HelloAllyTech/ally-platform' }) repo!: string;
  @ApiProperty() number!: number;
  @ApiProperty() url!: string;
  @ApiProperty({ enum: ['open', 'merged', 'closed'] })
  state!: AnalyticsAutomationPrState;
}

export class AnalyticsAutomationReviewDto {
  @ApiPropertyOptional({
    enum: ['approve', 'concerns', 'reject'],
    nullable: true,
    description: 'Null when the review agent itself failed.',
  })
  verdict!: AnalyticsAutomationReviewVerdict | null;
  @ApiProperty() summary!: string;
}

export class AnalyticsAutomationFindingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['posthog_event', 'dbt_change'] })
  kind!: AnalyticsAutomationFindingKind;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) detail!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;
  @ApiProperty({ enum: ['proposed', 'included', 'dropped', 'rejected'] })
  status!: AnalyticsAutomationFindingStatus;
}

export class AnalyticsAutomationAgentRunDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['posthog_events', 'dbt_metrics'] })
  agent!: AnalyticsAutomationAgentName;
  @ApiProperty() status!: AnalyticsAutomationAgentStatus;
  @ApiPropertyOptional({ nullable: true }) startedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Markdown shown to the reader.',
  })
  summary!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the agent is waiting, or why it failed.',
  })
  note!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  output!: Record<string, unknown>;
  @ApiPropertyOptional({
    type: AnalyticsAutomationPullRequestDto,
    nullable: true,
  })
  pullRequest!: AnalyticsAutomationPullRequestDto | null;
  @ApiPropertyOptional({ type: AnalyticsAutomationReviewDto, nullable: true })
  review!: AnalyticsAutomationReviewDto | null;
  @ApiPropertyOptional({ enum: ['approved', 'rejected'], nullable: true })
  decision!: AnalyticsAutomationDecision | null;
  @ApiPropertyOptional({ nullable: true }) decidedAt!: string | null;
  @ApiProperty({
    description: 'Whether Approve is available now (dbt agent only).',
  })
  canApprove!: boolean;
  @ApiProperty({ description: 'Whether Reject is available now.' })
  canReject!: boolean;
  @ApiProperty({ type: [AnalyticsAutomationFindingDto] })
  findings!: AnalyticsAutomationFindingDto[];
}

export class AnalyticsAutomationAgentStatusDto {
  @ApiProperty({ enum: ['posthog_events', 'dbt_metrics'] })
  agent!: AnalyticsAutomationAgentName;
  @ApiProperty() status!: AnalyticsAutomationAgentStatus;
}

/** One run as listed in the sidebar. */
export class AnalyticsAutomationRunSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'When the run started (ISO 8601).' })
  ranAt!: string;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: string | null;
  @ApiProperty({ enum: ['running', 'completed', 'failed'] })
  status!: AnalyticsAutomationRunStatus;
  @ApiProperty({ type: [AnalyticsAutomationAgentStatusDto] })
  agents!: AnalyticsAutomationAgentStatusDto[];
}

export class AnalyticsAutomationRunDetailDto extends AnalyticsAutomationRunSummaryDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  commitShas!: AnalyticsAutomationCommitShas;
  @ApiProperty({ type: [AnalyticsAutomationAgentRunDto] })
  agentRuns!: AnalyticsAutomationAgentRunDto[];
}
