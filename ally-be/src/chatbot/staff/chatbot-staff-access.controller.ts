import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { StaffOnly } from '../../auth/decorators/staff-only.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AssistantScope, ChatbotCan } from '../access/chatbot-role.decorator';
import { ChatbotCapability } from '../enum/chatbot.enum';
import {
  ChatbotStaffAccessService,
  STAFF_GRANT_DEFAULT_HOURS,
  STAFF_GRANT_MAX_HOURS,
} from './chatbot-staff-access.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const userId = (): number => Number(ExecutionManager.getUserId() ?? 0);

export class GrantStaffAccessDto {
  @ApiPropertyOptional({
    default: STAFF_GRANT_DEFAULT_HOURS,
    minimum: 1,
    maximum: STAFF_GRANT_MAX_HOURS,
    description: 'How long Ally staff may read conversations, in hours',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_GRANT_MAX_HOURS)
  hours?: number;

  @ApiPropertyOptional({ description: 'Why, for the record (optional)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class StaffViewsQueryDto {
  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class StaffSearchQueryDto {
  @ApiPropertyOptional({ description: 'Chatbot name, or owner name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/**
 * Assistants stage 8, the owner's side: let Ally staff read conversations for a while, take that
 * back, and see every staff view of the chatbot. Owners only.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ChatbotStaffAccessController {
  constructor(private readonly staff: ChatbotStaffAccessService) {}

  @Get(':id/staff-access')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      "The owner's permissions for Ally staff to read conversations (live, expired, revoked)",
  })
  async listGrants(@Param('id', ParseUUIDPipe) id: string) {
    return { grants: await this.staff.listGrants(id) };
  }

  @Post(':id/staff-access')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Let Ally staff read conversations, memory and contacts for a while (default 24 hours, at most 7 days); replaces a live one',
  })
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantStaffAccessDto,
  ) {
    return this.staff.grant(id, userId(), dto);
  }

  @Delete(':id/staff-access/:grantId')
  @HttpCode(204)
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Take the permission back at once' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
  ) {
    await this.staff.revoke(id, grantId, userId());
  }

  @Get(':id/staff-views')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'Who from Ally looked at this chatbot, when, and at what',
  })
  async views(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StaffViewsQueryDto,
  ) {
    return { views: await this.staff.listViews(id, query.limit) };
  }
}

/** Assistants stage 8, the staff side: find any chatbot to open read-only. Staff only (404). */
@ApiTags('Staff')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/staff/chatbots')
export class StaffChatbotsController {
  constructor(private readonly staff: ChatbotStaffAccessService) {}

  @Get()
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'Search every chatbot by name or owner (logged); open one read-only through the usual routes',
  })
  search(@Query() query: StaffSearchQueryDto) {
    return this.staff.search(userId(), query.q ?? '');
  }

  @Get(':id/conversation-access')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      "Whether the owner's grant to read conversations is live, and until when (logged)",
    description:
      'The grant’s existence and expiry only, never conversation content: `{granted, expiresAt?}`. Lets the read-only view show the right state without a 403 from a conversation route.',
  })
  conversationAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.conversationAccess(userId(), id);
  }
}
