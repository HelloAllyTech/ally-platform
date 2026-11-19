import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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
import { DebriefLearnerEventsService } from '../service/debrief-learner-events.service';
import { DebriefLearnerFeaturesService } from '../service/debrief-learner-features.service';
import {
  DebriefLearnerCommentsService,
  LEARNER_COMMENT_MAX_ITEMS,
} from '../service/debrief-learner-comments.service';
import { COMMENT_BODY_MAX } from '../util/debrief-review.util';
import { DebriefLearnerFeature } from '../enum/debrief-review.enum';
import {
  DEBRIEF_CLIENT_EVENT_KINDS,
  DEBRIEF_PLATFORMS,
  DEBRIEF_PULSE_QUESTIONS,
  DebriefPulseQuestion,
} from '../entity/debrief-learner-event.entity';

class PlatformDto {
  @ApiProperty({ required: false, enum: DEBRIEF_PLATFORMS })
  @IsOptional()
  @IsString()
  platform?: string;
}
class LearnerEventDto extends PlatformDto {
  @ApiProperty({ enum: DEBRIEF_CLIENT_EVENT_KINDS })
  @IsIn(DEBRIEF_CLIENT_EVENT_KINDS as unknown as string[])
  kind!: (typeof DEBRIEF_CLIENT_EVENT_KINDS)[number];
}
class PulseDto extends PlatformDto {
  @ApiProperty({ enum: DEBRIEF_PULSE_QUESTIONS })
  @IsIn(DEBRIEF_PULSE_QUESTIONS as unknown as string[])
  question!: DebriefPulseQuestion;

  @ApiProperty()
  @IsBoolean()
  answer!: boolean;
}
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

  @ApiProperty({
    required: false,
    description:
      'The card the question is about, when the learner asked from one (e.g. `work_on_this[0]`)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  section?: string;
}

class SelectionCommentDto {
  @ApiProperty({ example: 'work_on_this[0].why' })
  @IsString()
  @MaxLength(64)
  section!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  spanStart!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  spanEnd!: number;

  @ApiProperty({ description: 'The selected words, checked against the card' })
  @IsString()
  @MaxLength(2000)
  quotedText!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;
}

class LearnerCommentsDto {
  @ApiProperty({
    required: false,
    description: 'A comment on the debrief as a whole',
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  overall?: string;

  @ApiProperty({ required: false, type: [SelectionCommentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LEARNER_COMMENT_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SelectionCommentDto)
  items?: SelectionCommentDto[];
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
    private readonly learnerEvents: DebriefLearnerEventsService,
    private readonly toggles: FeatureToggleService,
    private readonly learnerFeatures: DebriefLearnerFeaturesService,
    private readonly learnerComments: DebriefLearnerCommentsService,
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

  @Post('sessions/:sessionId/opened')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: 'The learner opened the debrief (v9 FR-31), recorded once',
    description:
      'Sent by the app once the ready debrief has been on screen, in the foreground, for at least 2 seconds.',
  })
  async opened(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
    @Body() body: PlatformDto = {},
  ) {
    const res = await this.feedback.markOpened(sessionId, user.id);
    await this.learnerEvents.recordForLearner(
      sessionId,
      user.id,
      'opened',
      DebriefLearnerEventsService.platform(body?.platform),
    );
    return res;
  }

  @Post('sessions/:sessionId/events')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary: 'Something the learner did that only the app can see (v9 §3.3)',
    description:
      'read_through: the end of the first Work-on-this card was on screen. practise_next_click: "Practise this next" was tapped. waited: the working screen was shown. left_before_ready: the learner left while it was still working. Recorded once per session and kind.',
  })
  event(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
    @Body() body: LearnerEventDto,
  ) {
    return this.learnerEvents.recordForLearner(
      sessionId,
      user.id,
      body.kind,
      DebriefLearnerEventsService.platform(body.platform),
    );
  }

  @Get('scenarios/:scenarioId/latest-points')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary:
      "The points from the learner's latest debrief for a roleplay, for its Reminders tab",
    description:
      'Empty when their organisation is not switched on or they have no debrief for this roleplay yet.',
  })
  async latestPoints(
    @Param('scenarioId', ParseIntPipe) scenarioId: number,
    @CurrentUser() user: TokenUser,
  ) {
    if (!(await this.agent.isLive(user.tenantId ?? null))) {
      return { runId: null, workOnThis: [], practiseNext: null };
    }
    return this.feedback.latestPoints(scenarioId, user.id);
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
  async readAloud(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('section') section: string,
    @CurrentUser() user: TokenUser,
  ) {
    const res = await this.audio.audioUrl(sessionId, user.id, section);
    void this.learnerEvents
      .recordForLearner(sessionId, user.id, 'listened', null)
      .catch(() => undefined);
    return res;
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
    const decorated = await this.feedback.decorate(view, user.id);
    // PRD §9: the pulse, only on a debrief it asks on.
    const pulse = await this.learnerEvents.pulseFor(view, user.id);
    const withPulse = pulse ? { ...decorated, pulse } : decorated;
    // Learner features this person has (web only: the apps that do not know it ignore it).
    const selectionComments = await this.learnerFeatures.isEnabled(
      DebriefLearnerFeature.SELECTION_COMMENTS,
      user.id,
    );
    return { ...withPulse, features: { selectionComments } };
  }

  @Post('sessions/:sessionId/comments')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary:
      'Comments on selected words in the learner’s own debrief, sent together',
    description:
      'Only for people the Ally team has given the feature. Each comment names the card and the exact words; an overall comment is optional.',
  })
  addComments(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: LearnerCommentsDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.learnerComments.add(sessionId, user.id, body);
  }

  @Put('sessions/:sessionId/pulse')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({
    summary:
      'The post-launch pulse (PRD §9): "Did you know what to practise next?" / "Did this feel fair?"',
    description:
      'Asked on 1 in 10 debriefs for the first 8 weeks after an organisation goes live (the view carries `pulse` then). One answer per question; answering again changes it. 404 on a debrief the pulse does not ask on.',
  })
  pulse(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: PulseDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.learnerEvents.answerPulse(
      sessionId,
      user.id,
      body.question,
      body.answer,
      DebriefLearnerEventsService.platform(body.platform),
    );
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
    const stream = await this.replies.stream(sessionId, user.id, body.message, {
      section: body.section ?? null,
    });
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
