import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DebriefCalibrationService } from '../service/debrief-calibration.service';

/**
 * One debrief in the calibration set, for the console's "Score by hand"
 * (scores are saved through the console's `sessions/:sessionId/score`).
 * Behind the same ANALYTICS toggle as the foundational-skills human ratings.
 */
@ApiTags('Debrief quality')
@Controller('v1/analytics/debrief-quality/calibration')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefCalibrationController {
  constructor(private readonly calibration: DebriefCalibrationService) {}

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
}
