import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DebriefEngagementEvent,
  DebriefThreadQualifiedEventParams,
} from 'src/learn/type/debrief-engagement-event.type';
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
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { DebriefFlagReason } from '../enum/debrief-run.enum';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefAudioService } from '../service/debrief-audio.service';
import { DebriefReplyService } from '../service/debrief-reply.service';

class HelpfulDto {
  @ApiProperty()
  @IsBoolean()
  helpful!: boolean;
}

class ReplyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  message!: string;
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
    private readonly replies: DebriefReplyService,
    private readonly audio: DebriefAudioService,
    private readonly events: EventEmitter2,
    private readonly toggles: FeatureToggleService,
  ) {}

  @Post('sessions/:sessionId/read')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: 'The learner read the debrief to the end (earns XP once)',
    description:
      'Sent by the app once the end of the last Work-on-this card has been on screen with the debrief open for at least 30 seconds.',
  })
  async read(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const run = await this.feedback.ownLiveRun(sessionId, user.id);
    this.events.emit(DebriefEngagementEvent.READ_QUALIFIED, {
      userId: user.id,
      tenantId: run.tenantId as string,
      scenarioSessionId: sessionId,
    } as DebriefThreadQualifiedEventParams);
    return { ok: true };
  }

  @Get('sessions/:sessionId/supervisor')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_SESSION])
  @ApiOperation({
    summary:
      "A supervisor's read-only view of a learner's debrief: cards, flags, helpful and the Ask Ally thread",
  })
  async supervisor(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.feedback.supervisorView(sessionId, {
      tenantId: user.tenantId ?? null,
      platformAdmin: await this.toggles.isPlatformTierAdmin(user.id),
    });
  }

  @Get('sessions/:sessionId/audio/:section')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: 'Read-aloud: a short-lived link to one card read aloud',
    description:
      'Generated on the first request and cached by the card text, so a second play makes no TTS call.',
  })
  readAloud(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('section') section: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.audio.audioUrl(sessionId, user.id, section);
  }

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

  @Post('sessions/:sessionId/reply/stream')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary:
      'Ask Ally: a reply about the debrief, streamed as server-sent events',
  })
  async reply(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: ReplyDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    // Ownership and a published debrief are checked before the stream opens,
    // so a refusal is an ordinary HTTP error, not a broken stream.
    const stream = await this.replies.stream(sessionId, user.id, body.message);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    stream.subscribe({
      next: (e) => res.write(`data: ${e.data}\n\n`),
      complete: () => res.end(),
      error: () => res.end(),
    });
  }
}
