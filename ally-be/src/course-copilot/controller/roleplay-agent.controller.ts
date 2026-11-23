import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { StartRoleplayAgentRunDto } from '../dto/roleplay-agent.dto';
import { RoleplayAgentService } from '../service/roleplay-agent.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_COURSE_COPILOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_COURSE_COPILOT] };

/**
 * The roleplay agent on its own: one roleplay from a short request, outside any course. Same
 * gate as Course Copilot, which already builds roleplays with it. Runs are private to the admin
 * who started them.
 */
@ApiTags('Roleplay Agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/roleplay-agent')
export class RoleplayAgentController {
  constructor(private readonly roleplayAgent: RoleplayAgentService) {}

  @Get('options')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, VIEW)
  @ApiOperation({
    summary:
      'Modes, competencies, languages and trigger warnings for the request form',
  })
  options() {
    return this.roleplayAgent.options();
  }

  @Post('runs')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary: 'Start building one roleplay; poll the run for progress',
  })
  start(@Body() dto: StartRoleplayAgentRunDto, @CurrentUser() user: TokenUser) {
    return this.roleplayAgent.start(user, dto);
  }

  @Get('runs/:runId')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, VIEW)
  @ApiOperation({ summary: "A run's step, and its roleplay card once done" })
  get(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplayAgent.get(runId, String(user.id));
  }
}
