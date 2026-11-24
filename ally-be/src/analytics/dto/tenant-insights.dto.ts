import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { INSIGHT_SNOOZE_DAYS_MAX } from '../constants/tenant-insight-rules.constants';

export class TenantInsightDto {
  @ApiProperty({
    description:
      'Names the finding and the week it was found in; used to put it away',
  })
  fingerprint!: string;

  @ApiProperty({
    description:
      'The rule. The sentence is written from it by the client, in the reader’s language',
  })
  ruleId!: string;

  @ApiProperty({ enum: ['attention', 'celebrate'] })
  polarity!: 'attention' | 'celebrate';

  @ApiProperty({ description: '0 to 1: how much it matters' })
  severity!: number;

  @ApiProperty({
    type: Object,
    description: 'The numbers and names the sentence is written from',
  })
  params!: Record<string, string | number>;

  @ApiProperty({ description: 'The chart the finding comes from' })
  chartId!: string;

  @ApiProperty({
    enum: ['organisation', 'course', 'learner'],
    description: 'The tab that chart is on',
  })
  view!: 'organisation' | 'course' | 'learner';

  @ApiProperty({
    required: false,
    type: Object,
    description:
      'The course or learner that shows the finding, when it is about one',
  })
  filters?: Record<string, string>;
}

export class TenantInsightsResponseDto {
  @ApiProperty({ type: () => [TenantInsightDto] })
  attention!: TenantInsightDto[];

  @ApiProperty({ type: () => [TenantInsightDto] })
  celebrate!: TenantInsightDto[];
}

export class TenantInsightStateBodyDto {
  @ApiProperty()
  @Matches(/^[A-Za-z0-9._:-]{1,200}$/)
  fingerprint!: string;

  @ApiProperty({ enum: ['done', 'snoozed'] })
  @IsIn(['done', 'snoozed'])
  state!: 'done' | 'snoozed';

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: INSIGHT_SNOOZE_DAYS_MAX,
    description: 'How many days "snoozed" hides it; ignored for "done"',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INSIGHT_SNOOZE_DAYS_MAX)
  days?: number;
}
