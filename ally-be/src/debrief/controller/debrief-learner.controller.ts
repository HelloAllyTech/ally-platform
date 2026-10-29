import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { DebriefAgentService } from '../service/debrief-agent.service';

/**
 * The learner's Debrief tab: their own session's debrief from the Debrief
 * agent, when their organisation has been switched on. Anything else answers
 * `not_available`, and the apps keep showing today's debrief.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefLearnerController {
  constructor(private readonly agent: DebriefAgentService) {}

  @Get('sessions/:sessionId')
  // Same permission as reading the session's existing debrief chat; the
  // service then refuses anyone but the learner who did the session.
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({ summary: "The learner's debrief for one of their sessions" })
  get(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.agent.learnerView(sessionId, user.id);
  }
}
