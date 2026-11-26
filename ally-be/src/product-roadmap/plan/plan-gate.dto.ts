import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BuilderBriefResponseDto } from 'src/builder/dto/builder.dto';
import { CLOSE_REASON_MAX } from 'src/product-planning/util/plan-close-readiness.util';
import { PLANNER_MESSAGE_MAX } from './plan-turn.service';

/**
 * Close plan's body. Optional as a whole and in its field: the released
 * frontend posts nothing, which still closes a plan with no open blockers.
 */
export class RoadmapClosePlanDto {
  @ApiPropertyOptional({
    maxLength: CLOSE_REASON_MAX,
    description:
      'Why the plan is closed while it still has open blockers. Required only then; printed at the top of the build brief.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CLOSE_REASON_MAX)
  reason?: string;
}

/**
 * The planner's message to the planning agent. Empty asks for the opening situation brief.
 * With `briefResponse` it is the planner's answer to that brief, line by line, and `text` is the
 * one-line summary the transcript shows.
 */
export class RoadmapPlanMessageDto {
  @ApiPropertyOptional({ maxLength: PLANNER_MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PLANNER_MESSAGE_MAX)
  text?: string;

  @ApiPropertyOptional({
    type: BuilderBriefResponseDto,
    description: 'When answering the situation brief: a verdict per line',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuilderBriefResponseDto)
  briefResponse?: BuilderBriefResponseDto;
}
