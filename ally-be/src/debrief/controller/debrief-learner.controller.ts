import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
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
import { DebriefFlagReason } from '../enum/debrief-run.enum';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';

class HelpfulDto {
  @ApiProperty()
  @IsBoolean()
  helpful!: boolean;
}

class FlagDto {
  @ApiProperty({ example: 'work_on_this[0]' })
  @Matches(
    /^(important_moment|opening|practise_next|reflective_question|progress_note|(what_worked|work_on_this)\[[0-2]\])$/,
  )
  section!: string;

  @ApiProperty({ enum: Object.values(DebriefFlagReason) })
  @IsIn(Object.values(DebriefFlagReason))
  reason!: DebriefFlagReason;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

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
  constructor(
    private readonly agent: DebriefAgentService,
    private readonly feedback: DebriefFeedbackService,
  ) {}

  @Get('sessions/:sessionId')
  // Same permission as reading the session's existing debrief chat; the
  // service then refuses anyone but the learner who did the session.
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({ summary: "The learner's debrief for one of their sessions" })
  async get(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const view = await this.agent.learnerView(sessionId, user.id);
    return this.feedback.decorate(view, user.id);
  }

  @Put('sessions/:sessionId/helpful')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: '"Was this helpful?" — one answer per debrief, changeable',
  })
  helpful(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: HelpfulDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.feedback.setHelpful(sessionId, user.id, body.helpful);
  }

  @Post('sessions/:sessionId/flags')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: '"This isn\'t right" on one card',
    description:
      'One flag per card. A flag on the important moment is reviewed first.',
  })
  flag(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: FlagDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.feedback.flag(sessionId, user.id, body);
  }

  @Delete('sessions/:sessionId/flags/:flagId')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({ summary: 'Undo a flag within 10 minutes of sending it' })
  undo(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.feedback.undoFlag(sessionId, user.id, flagId);
  }
}
