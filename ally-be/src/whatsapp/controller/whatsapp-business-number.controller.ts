import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  ConnectWaNumberManualDto,
  WaBusinessNumberResponseDto,
  WaNumberListQueryDto,
} from '../dto/whatsapp-business-number.dto';
import { WhatsAppBusinessNumberService } from '../service/whatsapp-business-number.service';
import { WhatsAppConnectionCheck } from '../type/whatsapp-provider.interface';

/**
 * WhatsApp numbers — the WhatsApp connector type's own routes (connect, check, subscribe).
 *
 * @CallerScopedRoute: access follows the bot each number's connector serves, checked in the
 * service, rather than an organisation in the query.
 */
@ApiTags('WhatsApp Bot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/whatsapp/numbers')
@CallerScopedRoute()
export class WhatsAppBusinessNumberController {
  constructor(private readonly service: WhatsAppBusinessNumberService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary:
      "One chatbot's WhatsApp numbers, or every number (platform admins, no chatbotId)",
  })
  @ApiResponse({ status: 200, type: [WaBusinessNumberResponseDto] })
  list(
    @Query() query: WaNumberListQueryDto,
  ): Promise<WaBusinessNumberResponseDto[]> {
    return this.service.list(query.chatbotId);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiResponse({ status: 200, type: WaBusinessNumberResponseDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaBusinessNumberResponseDto> {
    return this.service.get(id);
  }

  @Post('manual')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Connect a number from a Meta app, as a WhatsApp connector',
    description:
      'The details are checked with Meta before anything is stored. The response carries the ' +
      'Callback URL and Verify token to paste into the Meta app.',
  })
  @ApiResponse({ status: 201, type: WaBusinessNumberResponseDto })
  connectManual(
    @Body() dto: ConnectWaNumberManualDto,
  ): Promise<WaBusinessNumberResponseDto> {
    return this.service.connectManual(dto);
  }

  @Post(':id/check')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check the number with Meta and record the result' })
  check(@Param('id', ParseUUIDPipe) id: string): Promise<{
    number: WaBusinessNumberResponseDto;
    check: WhatsAppConnectionCheck;
  }> {
    return this.service.check(id);
  }

  @Post(':id/subscribe')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Subscribe the Meta app to the number's WhatsApp account",
    description:
      'Without this the webhook verifies but Meta delivers no messages. Idempotent.',
  })
  @ApiResponse({ status: 200, type: WaBusinessNumberResponseDto })
  subscribe(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaBusinessNumberResponseDto> {
    return this.service.subscribe(id);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect the number',
    description:
      'Its stored credentials are wiped. Messages to it are no longer answered.',
  })
  disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.disconnect(id);
  }
}
