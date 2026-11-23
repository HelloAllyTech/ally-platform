import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PmLessonResponse } from '../dto/pm-agent.dto';
import { PmAgentLessonsService } from './pm-lessons.service';

type AuthedRequest = { user: { id: number } };

/**
 * Weekly lessons routes (docs/pm-agent.md, "Weekly lessons"), same base and toggle as
 * PmAgentController. Editing and removing a lesson go through PATCH/DELETE /memory/:id.
 */
@ApiTags('PM Agent')
@Controller('v1/pm-agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class PmAgentLessonsController {
  constructor(private readonly lessons: PmAgentLessonsService) {}

  @Post('lessons/run')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({
    summary: 'Run the weekly lessons job now',
    description:
      'Answers at once: { started: true } or { started: false, reason } with reason disabled, lessons_disabled, already_running or budget_exhausted.',
  })
  run(): Promise<{ started: boolean; reason?: string }> {
    return this.lessons.runNow();
  }

  @Post('lessons/:id/confirm')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.PM_AGENT)
  @ApiOperation({ summary: 'Confirm a proposed lesson (proposed → active)' })
  @ApiResponse({ status: 409, description: 'The lesson is not proposed' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<PmLessonResponse> {
    return this.lessons.confirm(req.user.id, id);
  }
}
