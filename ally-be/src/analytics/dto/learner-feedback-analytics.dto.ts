import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/** Default page size for the feed. */
export const LEARNER_FEEDBACK_DEFAULT_LIMIT = 25;
/** Largest page the feed will return in one request. */
export const LEARNER_FEEDBACK_MAX_LIMIT = 100;

/**
 * The post-session ratings feed takes the shared window params (the window is
 * on the SESSION's end time, like the sentiment charts beside it) plus its own
 * filters. Only `ratings`, `commentsOnly` and `search` narrow the list; the
 * summary always describes the whole window, so the reader can see what the
 * filters left out.
 */
export class LearnerFeedbackQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({
    description:
      'Comma-separated star ratings to keep, e.g. `1,2`. Omitted keeps all.',
    required: false,
    example: '1,2',
  })
  @IsOptional()
  @Matches(/^[1-5](,[1-5]){0,4}$/, {
    message: 'ratings must be a comma-separated list of 1-5',
  })
  ratings?: string;

  @ApiProperty({
    description:
      "'true' (default) lists only ratings that carry a written comment; " +
      "'false' lists every rating.",
    enum: ['true', 'false'],
    required: false,
    default: 'true',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  commentsOnly?: 'true' | 'false';

  @ApiProperty({
    description:
      'Case-insensitive text match against the comment, the learner name ' +
      'and the roleplay title.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiProperty({
    required: false,
    default: LEARNER_FEEDBACK_DEFAULT_LIMIT,
    minimum: 1,
    maximum: LEARNER_FEEDBACK_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEARNER_FEEDBACK_MAX_LIMIT)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** One learner rating, with its comment if they wrote one. */
export class LearnerFeedbackItemDto {
  @ApiProperty({ description: 'scenario_session_feedbacks.id' })
  feedbackId!: string;

  @ApiProperty({ description: 'The rated roleplay session (uuid)' })
  sessionId!: string;

  @ApiProperty({
    description: 'When the session ended (its start if it never ended), ISO',
  })
  sessionAt!: string;

  @ApiProperty({ description: 'When the learner submitted the rating, ISO' })
  ratedAt!: string;

  @ApiProperty({ description: 'Star rating, 1-5' })
  rating!: number;

  @ApiProperty({
    description: 'The written comment, trimmed; null when they left none',
    nullable: true,
    type: String,
  })
  comment!: string | null;

  @ApiProperty({
    description:
      'Quick-pick tags the learner chose, as stored (may be localised)',
    type: [String],
  })
  tags!: string[];

  @ApiProperty({ nullable: true, type: Number })
  learnerId!: number | null;

  @ApiProperty({ nullable: true, type: String })
  learnerName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  tenantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  orgName!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  scenarioId!: number | null;

  @ApiProperty({ nullable: true, type: String })
  scenarioTitle!: string | null;

  @ApiProperty({
    description: "The session's language label, when it was set",
    nullable: true,
    type: String,
  })
  language!: string | null;
}

export class LearnerFeedbackRatingCountDto {
  @ApiProperty({ description: 'Star rating, 1-5' })
  rating!: number;

  @ApiProperty({ description: 'Ratings at this value in the window' })
  count!: number;

  @ApiProperty({ description: 'Of those, how many carry a written comment' })
  withComment!: number;
}

/** The whole window, before the feed's own filters. */
export class LearnerFeedbackSummaryDto {
  @ApiProperty({ description: 'Sessions rated in the window' })
  ratings!: number;

  @ApiProperty({ description: 'Of those, ratings with a written comment' })
  withComment!: number;

  @ApiProperty({
    description: 'Mean star rating, 2 dp; null when nothing was rated',
    nullable: true,
    type: Number,
  })
  avgRating!: number | null;

  @ApiProperty({
    description: 'Count per star, always all five (1 to 5), zeros included',
    type: [LearnerFeedbackRatingCountDto],
  })
  distribution!: LearnerFeedbackRatingCountDto[];
}

export class LearnerFeedbackResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({ type: LearnerFeedbackSummaryDto })
  summary!: LearnerFeedbackSummaryDto;

  @ApiProperty({
    description: 'One page of the filtered feed, newest session first',
    type: [LearnerFeedbackItemDto],
  })
  items!: LearnerFeedbackItemDto[];

  @ApiProperty({ description: 'Rows matching the filters, across all pages' })
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    description: 'Where the rows come from and what is left out',
  })
  provenance!: string;
}
