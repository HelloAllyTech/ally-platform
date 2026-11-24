import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, Matches } from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ChatbotRole } from '../../chatbot/access/chatbot-role.decorator';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { GoLiveGateService } from '../../chatbot/safety/go-live-gate.service';
import { CrisisSuiteService } from './crisis-suite.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

export class RunCrisisCheckDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Languages to check; default every enabled language',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, { each: true })
  languages?: string[];
}

/** Stage 4: the per-language crisis check that the go-live gate reads. */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class CrisisSuiteController {
  constructor(
    private readonly suite: CrisisSuiteService,
    private readonly gate: GoLiveGateService,
  ) {}

  @Post(':id/crisis-check')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Run the crisis check in each language (or the ones given); a failing language is turned off. Needs credits (402 credits_required at $0).',
  })
  async run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunCrisisCheckDto,
  ) {
    const results = await this.suite.run(id, dto.languages);
    return { results, checklist: await this.gate.check(id) };
  }
}
