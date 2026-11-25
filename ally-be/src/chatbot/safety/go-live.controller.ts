import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { StaffOnly } from '../../auth/decorators/staff-only.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AssistantScope, ChatbotRole } from '../access/chatbot-role.decorator';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { GoLiveBackfillService } from './go-live-backfill.service';
import { GoLiveGateService } from './go-live-gate.service';
import { SafetyStateService } from './safety-state.service';
import { SAFETY_TERMS_TEXT, SAFETY_TERMS_VERSION } from './safety-terms';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

export class AcceptSafetyTermsDto {
  @ApiProperty({
    description: 'The version the owner read (GET …/safety-terms)',
  })
  @IsString()
  @MaxLength(32)
  version!: string;
}

export class UnpublishBackfillQueryDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(
    ({ value }) => !(value === false || value === 'false' || value === '0'),
  )
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * Stage 4: the go-live checklist, the safety terms, and the D10 unpublish backfill.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1')
@CallerScopedRoute()
export class GoLiveController {
  constructor(
    private readonly gate: GoLiveGateService,
    private readonly state: SafetyStateService,
    private readonly backfill: GoLiveBackfillService,
  ) {}

  @Get('chatbots/:id/go-live')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'The go-live checklist: what is missing before customers can use it, and each language’s crisis check',
  })
  checklist(@Param('id', ParseUUIDPipe) id: string) {
    return this.gate.checklist(id);
  }

  @Get('chatbots/:id/safety-terms')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'The safety terms to accept, and what was accepted',
  })
  async terms(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.state.get(id);
    return {
      version: SAFETY_TERMS_VERSION,
      text: SAFETY_TERMS_TEXT,
      acceptedVersion: s.termsVersion,
      acceptedAt: s.termsAcceptedAt
        ? new Date(s.termsAcceptedAt).toISOString()
        : null,
    };
  }

  @Post('chatbots/:id/safety-terms')
  @ChatbotRole(ChatbotMemberRole.OWNER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Accept the current safety terms (owners only)' })
  async acceptTerms(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptSafetyTermsDto,
  ) {
    if (dto.version !== SAFETY_TERMS_VERSION) {
      throw new BadRequestException({
        errorCode: 'terms_outdated',
        // COPY: needs approval
        message: 'The safety terms have changed. Read them again and accept.',
        details: { version: SAFETY_TERMS_VERSION },
      });
    }
    await this.state.acceptTerms(
      id,
      SAFETY_TERMS_VERSION,
      Number(ExecutionManager.getUserId() ?? 0) || null,
    );
    return this.gate.checklist(id);
  }

  @Post('staff/assistants/unpublish-backfill')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'D10: pause every live chatbot that fails the go-live gate (dry run by default; idempotent)',
  })
  runBackfill(@Query() query: UnpublishBackfillQueryDto) {
    return this.backfill.run({ dryRun: query.dryRun !== false });
  }
}
