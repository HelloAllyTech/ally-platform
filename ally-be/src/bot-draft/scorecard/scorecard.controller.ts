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
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ScorecardService } from './scorecard.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

export class OwnerAnswerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @ApiPropertyOptional({
    description: '"Also add to checkup" (chunk 20d-2); ticked unless false',
  })
  @IsOptional()
  @IsBoolean()
  addToCheckup?: boolean;
}

/**
 * The live scorecard on the assistant's Overview (chunk Q2a): this week against last, the 7-day
 * trend, the questions it didn't know and the answers people weren't happy with.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ScorecardController {
  constructor(private readonly scorecard: ScorecardService) {}

  @Get(':id/scorecard')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'This week and last, in plain words, with what needs the owner',
  })
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.scorecard.view(id);
  }

  @Post(':id/scorecard/unanswered/:questionId/answer')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Answer it: an owner note and a checkup question from the answer',
  })
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: OwnerAnswerDto,
  ) {
    return this.scorecard.answerUnanswered(
      id,
      questionId,
      dto.text,
      dto.addToCheckup !== false,
    );
  }

  @Post(':id/scorecard/feedback/:feedbackId/correct')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Correct this: the right answer to what they asked, as with Answer it',
  })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('feedbackId', ParseUUIDPipe) feedbackId: string,
    @Body() dto: OwnerAnswerDto,
  ) {
    return this.scorecard.correctFeedback(
      id,
      feedbackId,
      dto.text,
      dto.addToCheckup !== false,
    );
  }

  @Post(':id/scorecard/feedback/:feedbackId/fine')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'It was fine: take the thumbs-down off the list' })
  fine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('feedbackId', ParseUUIDPipe) feedbackId: string,
  ) {
    return this.scorecard.markFine(id, feedbackId);
  }
}
