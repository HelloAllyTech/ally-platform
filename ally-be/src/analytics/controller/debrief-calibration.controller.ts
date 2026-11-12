import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { DebriefAct } from 'src/debrief/util/debrief-console-roles.util';
import { DebriefCalibrationService } from '../service/debrief-calibration.service';

/**
 * One debrief in the calibration set, for the console's "Score by hand"
 * (scores are saved through the console's `sessions/:sessionId/score`).
 * Gated like the console's score route (DebriefAct('score')): the clinical
 * advisor on `review:admin:debriefs` alone, without platform access, or the
 * Ally team on `system:access`.
 */
@ApiTags('Debrief quality')
@Controller('v1/analytics/debrief-quality/calibration')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefCalibrationController {
  constructor(private readonly calibration: DebriefCalibrationService) {}

  @Get(':scenarioSessionId')
  @DebriefAct('score')
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
