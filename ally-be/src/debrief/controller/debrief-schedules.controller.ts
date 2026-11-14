import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { SCHEDULE_FREQUENCIES } from '../constants/debrief-schedule.constants';
import { DebriefScheduleService } from '../service/debrief-schedule.service';

type AuthedRequest = { user: { id: number } };

class ScheduleChangeDto {
  @ApiProperty({ required: false, enum: SCHEDULE_FREQUENCIES })
  @IsOptional()
  @IsIn([...SCHEDULE_FREQUENCIES])
  frequency?: string;

  @ApiProperty({ required: false, description: 'HH:MM India time' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time?: string;

  @ApiProperty({ required: false, description: '0 = Sunday … 6 = Saturday' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @ApiProperty({ required: false, description: '1–28' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  monthDay?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Required (true) when the change alters learning-budget spend (PM agent analysis, monthly review, setting values: frequency or on/off)',
  })
  @IsOptional()
  @IsBoolean()
  confirmBudget?: boolean;
}

class HistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * Debrief › Settings › Schedules (CONSOLE_API.md "Schedules"): engineering
 * only. Every route needs platform access and the `debrief_schedules` admin
 * feature toggle, granted person by person.
 */
@ApiTags('Debrief console')
@ApiBearerAuth('JWT-auth')
@ApiSecurity('JWT-auth')
@Controller('v1/debriefs/console/schedules')
@RequireFeatureToggle(FeatureToggleKey.DEBRIEF_SCHEDULES)
export class DebriefSchedulesController {
  constructor(private readonly schedules: DebriefScheduleService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every debrief / PM agent job: schedule, allowed frequencies, last run, next run',
  })
  list() {
    return this.schedules.view();
  }

  @Get('runs')
  @ApiOperation({
    summary:
      'Run history, newest first, paged: scheduled runs and schedule changes (who, what, when)',
  })
  runs(@Query() q: HistoryQueryDto) {
    return this.schedules.history(q.page ?? 1, q.pageSize ?? 20);
  }

  @Patch(':key')
  @ApiOperation({
    summary:
      "Change a job's frequency, time, weekday, day of month or on/off. 409 BUDGET_CONFIRM_REQUIRED with the spend estimate until confirmBudget is sent for learning-budget jobs",
  })
  update(
    @Req() req: AuthedRequest,
    @Param('key') key: string,
    @Body() body: ScheduleChangeDto,
  ) {
    const { confirmBudget, ...change } = body;
    return this.schedules.update(key, change, req.user.id, !!confirmBudget);
  }
}
