import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  BuilderSessionVisibilityInterceptor,
  PlanParticipantWrite,
} from '../interceptor/builder-session-visibility.interceptor';
import { BuilderPlanConversationService } from '../service/builder-plan-conversation.service';

const ROADMAP = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

export class PlanAnswerDto {
  @ApiProperty() @IsString() @MaxLength(80) questionId!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  optionIds?: string[];

  @ApiProperty({
    description: 'Client uuid; a retried send returns the original post',
  })
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

export class PlanCommentDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsInt({ each: true })
  mentionUserIds?: number[];

  @ApiProperty() @IsString() @Length(8, 80) idempotencyKey!: string;
}

export class PlanSettleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 80)
  idempotencyKey?: string;
}

/**
 * Roadmap v2's one attributed session (plans/roadmap-builder-merge D13,
 * §4.5a): answers, comments and "Use this answer" on a shared plan session,
 * from anyone with Roadmap access. Gated by the board's toggle, not
 * Builder's, because Idea people answer too; BuilderSessionVisibilityInterceptor
 * lets these marked writes through by Roadmap role, and keeps every other
 * write on a plan the lead's or an Owner's. 404 while `roadmap_v2` is off.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseInterceptors(BuilderSessionVisibilityInterceptor)
@Controller({ path: 'builder', version: '1' })
export class BuilderPlanConversationController {
  constructor(private readonly conversation: BuilderPlanConversationService) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, ROADMAP)
  @Get('sessions/:sessionId/answers')
  @ApiOperation({
    summary: 'Every question with its attributed answers, and the comments',
  })
  list(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.conversation.list(sessionId, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, ROADMAP)
  @PlanParticipantWrite('answer')
  @Post('sessions/:sessionId/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Answer the agent's question; lands in the lead's next turn",
  })
  answer(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PlanAnswerDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.conversation.answer(sessionId, user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, ROADMAP)
  @PlanParticipantWrite('comment')
  @Post('sessions/:sessionId/comments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Comment to people, with @mentions (never an answer)',
  })
  comment(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PlanCommentDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.conversation.comment(sessionId, user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, ROADMAP)
  @PlanParticipantWrite('settle')
  @Post('sessions/:sessionId/answers/:postId/use')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Use this answer: the settler chooses (a decision)',
  })
  settle(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: PlanSettleDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.conversation.settle(
      sessionId,
      user.id,
      postId,
      dto?.idempotencyKey,
    );
  }
}
