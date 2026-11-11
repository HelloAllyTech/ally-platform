import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
  DebriefCommentTag,
  DebriefReviewVerdict,
} from '../enum/debrief-review.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefReviewService } from '../service/debrief-review.service';
import {
  COMMENT_BODY_MAX,
  QUOTE_MAX,
  REVIEW_SOURCES,
  ReviewSource,
} from '../util/debrief-review.util';

type AuthedRequest = { user: { id: number } };

/** The Debrief Console's toggle, plus "Review debriefs (expert)". */
const EXPERT = { permissions: [PERMISSIONS.REVIEW_DEBRIEFS] };

class QueueQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sessionType?: string;

  @IsOptional()
  @IsIn(REVIEW_SOURCES as unknown as string[])
  source?: ReviewSource;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeReviewed?: string;
}

class CommentDto {
  @ApiProperty({ enum: DebriefCommentAnchor })
  @IsEnum(DebriefCommentAnchor)
  anchorKind!: DebriefCommentAnchor;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  turnIndex?: number;

  @ApiProperty({
    required: false,
    description: 'The card and field, e.g. `work_on_this[0].why`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  section?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  spanStart?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  spanEnd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_MAX)
  quotedText?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;

  @ApiProperty({ required: false, description: 'Reply to this comment' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

class EditCommentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body?: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;
}

class StillHappeningDto extends CommentDto {
  @ApiProperty({ description: 'The later run it happened on' })
  @IsUUID()
  runId!: string;
}

class VerdictDto {
  @ApiProperty({ enum: DebriefReviewVerdict })
  @IsEnum(DebriefReviewVerdict)
  verdict!: DebriefReviewVerdict;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  hardFails?: string[];
}

/**
 * Expert review (debrief orchestrator spec Part B): the queue, the review
 * screen, comments and threads, the verdict, and "what happened to my
 * comment". Behind the Debrief Console's Analytics toggle AND "Review
 * debriefs (expert)"; every view writes an audit event, as the Console does.
 */
@ApiTags('Debriefs — expert review')
@Controller('v1/debriefs/expert-review')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefReviewController {
  constructor(private readonly reviews: DebriefReviewService) {}

  @Get('queue')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary:
      'Debriefs worth an expert review: risk cues, below the bar, learner flags, judge–Evaluator disagreements and a random sample',
  })
  queue(@Req() req: AuthedRequest, @Query() q: QueueQueryDto) {
    return this.reviews.queue(req.user.id, {
      tenantId: q.tenantId,
      language: q.language,
      sessionType: q.sessionType,
      source: q.source,
      includeReviewed: q.includeReviewed === 'true',
    });
  }

  @Get('my-comments')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary:
      'Your comments, each with the improvement idea it fed and its status',
  })
  myComments(@Req() req: AuthedRequest) {
    return this.reviews.myComments(req.user.id);
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary:
      'One debrief to review: transcript, the cards the learner read, flags, comments and your verdict',
  })
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.reviews.detail(id, req.user.id);
  }

  @Put('runs/:id/verdict')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary:
      'Give or change your verdict; it also joins the judge calibration set',
  })
  verdict(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: VerdictDto,
  ) {
    return this.reviews.setVerdict(id, req.user.id, body);
  }

  @Post('runs/:id/comments')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary: 'Comment on a line, a card or the whole debrief, or reply',
  })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: CommentDto,
  ) {
    return this.reviews.addComment(id, req.user.id, body);
  }

  @Patch('comments/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({ summary: 'Edit your comment' })
  editComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: EditCommentDto,
  ) {
    return this.reviews.editComment(id, req.user.id, body);
  }

  @Delete('comments/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({ summary: 'Delete your comment' })
  deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.deleteComment(id, req.user.id);
  }

  @Post('comments/:id/resolve')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({ summary: 'Resolve a thread' })
  resolve(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.reviews.setStatus(
      id,
      req.user.id,
      DebriefCommentStatus.RESOLVED,
    );
  }

  @Post('comments/:id/reopen')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({ summary: 'Re-open a resolved thread' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.reviews.setStatus(id, req.user.id, DebriefCommentStatus.OPEN);
  }

  @Post('comments/:id/still-happening')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS, EXPERT)
  @ApiOperation({
    summary:
      'The problem this comment raised happened again on a later debrief: re-open it there',
  })
  stillHappening(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: StillHappeningDto,
  ) {
    return this.reviews.stillHappening(id, req.user.id, body);
  }
}
