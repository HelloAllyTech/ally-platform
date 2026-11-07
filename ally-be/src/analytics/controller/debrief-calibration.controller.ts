import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DebriefCalibrationService } from '../service/debrief-calibration.service';

export class SubmitDebriefRatingDto {
  @ApiProperty({
    description: 'Every rubric dimension once, a whole number 0-10',
    example: { evidence_specificity: 7, accuracy: 9 },
  })
  @IsObject()
  scores!: Record<string, number>;

  @ApiProperty({ type: [String], description: 'Hard-fail codes found' })
  @IsArray()
  hardFails!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * The debrief calibration set's API: people score debriefs blind on the
 * independent judge's rubric. Internal raters and the clinical advisor only,
 * behind the same ANALYTICS toggle as the foundational-skills human ratings.
 */
@ApiTags('Debrief quality')
@Controller('v1/analytics/debrief-quality/calibration')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefCalibrationController {
  constructor(private readonly calibration: DebriefCalibrationService) {}

  @Get('sample')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'The calibration sample (super-admin)',
    description:
      'Up to 150 scored debriefs, stratified by judge-overall tercile × language and drawn ' +
      'in a seeded order, so the same debriefs come back while the scored population is ' +
      'unchanged. Each carries how many people have rated it and whether the caller has. ' +
      'No transcript text and no judge scores.',
  })
  getSample(@Req() req: { user: { id: number } }) {
    return this.calibration.getSample(req.user.id);
  }

  @Get('agreement')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Judge-vs-human and human-vs-human agreement, and the autonomy gate',
    description:
      'Quadratic-weighted κ per 0-10 dimension, κ per hard fail, both withheld below 20 ' +
      'rated debriefs. `gate.met` is true only while κ ≥ 0.6 on accuracy, evidence and ' +
      'specificity, and the missed-risk-cue hard fail: the standing gate on the debrief ' +
      "Improver's autonomy.",
  })
  getAgreement() {
    return this.calibration.getAgreement();
  }

  @Get(':scenarioSessionId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'One debrief to rate: redacted transcript and debrief, plus your rating',
  })
  getItem(
    @Req() req: { user: { id: number } },
    @Param('scenarioSessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.calibration.getItem(req.user.id, sessionId);
  }

  @Post(':scenarioSessionId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Submit or replace your rating of one debrief',
    description:
      '400 lists every problem (a dimension missing or outside 0-10, an unknown hard ' +
      "fail); 403 on a debrief of the caller's own practice; 404 on one the judge has " +
      'not scored.',
  })
  submit(
    @Req() req: { user: { id: number } },
    @Param('scenarioSessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: SubmitDebriefRatingDto,
  ) {
    return this.calibration.submit(req.user.id, sessionId, body);
  }
}
