import { ApiProperty } from '@nestjs/swagger';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/** The Ally guide charts take the shared window and the optional `tenantId`. */
export class AllyGuideAnalyticsQueryDto extends AnalyticsWindowQueryDto {}

/** A rate with the counts behind it; null and `suppressed` under the minimum group. */
export class AllyRateDto {
  @ApiProperty({
    nullable: true,
    description: '0–1, or null when suppressed or empty',
  })
  rate!: number | null;

  @ApiProperty({ description: 'Numerator' })
  count!: number;

  @ApiProperty({ description: 'Denominator' })
  of!: number;

  @ApiProperty({ description: 'Learners behind the rate' })
  learners!: number;

  @ApiProperty({
    description:
      'True when fewer learners than `minGroupSize`: the rate is withheld, the counts are kept',
  })
  suppressed!: boolean;
}

class AllyBaseResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({
    description: 'No rate is shown over fewer learners than this',
  })
  minGroupSize!: number;

  @ApiProperty()
  provenance!: string;
}

export class AllyGuideSummaryDto extends AllyBaseResponseDto {
  @ApiProperty() learners!: number;
  @ApiProperty() conversations!: number;
  @ApiProperty() learnerMessages!: number;
  @ApiProperty({
    type: AllyRateDto,
    description: 'Share of rated replies rated up',
  })
  thumbsUp!: AllyRateDto;
  @ApiProperty() costUsd!: number;
  @ApiProperty({ nullable: true }) costPerLearnerUsd!: number | null;
}

export class AllyWeekDto {
  @ApiProperty({ description: 'Monday of the ISO week (yyyy-mm-dd)' })
  week!: string;
  @ApiProperty() activeLearners!: number;
  /** AAQ-241 */
  @ApiProperty({ type: AllyRateDto }) firstSessionWin!: AllyRateDto;
  @ApiProperty({ type: AllyRateDto }) firstWinWithin5Min!: AllyRateDto;
  /** AAQ-242 */
  @ApiProperty({ nullable: true }) itemsPerLearningDay!: number | null;
  /** AAQ-243 */
  @ApiProperty({ type: AllyRateDto }) sevenDayReturn!: AllyRateDto;
  /** AAQ-244 */
  @ApiProperty() appointmentsSet!: number;
  @ApiProperty({ type: AllyRateDto }) appointmentsKept!: AllyRateDto;
  /** AAQ-245 */
  @ApiProperty({ type: AllyRateDto }) voiceAdoption!: AllyRateDto;
  /** AAQ-246 */
  @ApiProperty({ type: AllyRateDto }) quizFirstAttemptPass!: AllyRateDto;
  @ApiProperty({ type: AllyRateDto }) quizFirstAttemptPassClassic!: AllyRateDto;
  /** AAQ-247 */
  @ApiProperty({ nullable: true }) roleplayScore!: number | null;
  @ApiProperty({ nullable: true }) roleplayScoreClassic!: number | null;
  /** AAQ-249: per 100 active learners. */
  @ApiProperty({ nullable: true }) careEntriesPer100!: number | null;
  @ApiProperty({ nullable: true }) crisisEntriesPer100!: number | null;
  /** AAQ-250 */
  @ApiProperty({ type: AllyRateDto }) offCourse!: AllyRateDto;
  @ApiProperty({ type: AllyRateDto }) refusals!: AllyRateDto;
}

export class AllyGuideWeeklyDto extends AllyBaseResponseDto {
  @ApiProperty({ type: [AllyWeekDto] })
  weeks!: AllyWeekDto[];
}

export class AllyPairedWeekDto {
  @ApiProperty() week!: string;
  @ApiProperty() activeLearners!: number;
  @ApiProperty({
    nullable: true,
    description: 'Engagement: items completed per learning day',
  })
  itemsPerLearningDay!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Engagement: share of rated replies rated up',
  })
  thumbsUpShare!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Learning: quiz first-attempt pass rate',
  })
  quizFirstAttemptPass!: number | null;
  @ApiProperty({
    enum: ['ok', 'engagement_up_learning_flat', 'learning_fell', 'too_few'],
    description:
      'The learning-metric guard against the previous week (plan §4.13)',
  })
  guard!: 'ok' | 'engagement_up_learning_flat' | 'learning_fell' | 'too_few';
}

export class AllyGuideEngagementLearningDto extends AllyBaseResponseDto {
  @ApiProperty({ type: [AllyPairedWeekDto] })
  weeks!: AllyPairedWeekDto[];
}

export class AllyCourseCostDto {
  @ApiProperty({
    nullable: true,
    description: 'Null for the folded "Other courses" row',
  })
  trackId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() learners!: number;
  @ApiProperty() turns!: number;
  @ApiProperty() costUsd!: number;
  @ApiProperty({ nullable: true }) costPerLearnerUsd!: number | null;
  @ApiProperty({
    description:
      'Courses folded in because each had fewer learners than the minimum',
  })
  folded!: number;
}

export class AllyGuideCoursesDto extends AllyBaseResponseDto {
  @ApiProperty({ type: [AllyCourseCostDto] })
  courses!: AllyCourseCostDto[];
}
