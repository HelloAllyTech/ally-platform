import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { BindConnectorDto } from '../dto/chatbot.dto';
import { ConnectorService } from '../service/connector.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * Connectors of every type. Creating one is the type's own flow (e.g. `POST v1/whatsapp/numbers`);
 * these routes list, move and disconnect them.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/connectors')
@CallerScopedRoute()
export class ConnectorController {
  constructor(private readonly connectors: ConnectorService) {}

  @Get('types')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'The kinds of connector this deployment supports' })
  types() {
    return this.connectors.types();
  }

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiQuery({ name: 'chatbotId', required: false })
  @ApiOperation({
    summary:
      'One bot’s connectors, or (platform admins, no chatbotId) every connector including free ones',
  })
  list(@Query('chatbotId') chatbotId?: string) {
    return this.connectors.list(chatbotId || undefined);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.get(id);
  }

  @Patch(':id/chatbot')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Move a connector to a bot, or free it (chatbotId null)',
    description:
      'The next message is answered by the new bot; existing conversations stay with the bot that answered them.',
  })
  bind(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BindConnectorDto) {
    return this.connectors.bind(id, dto.chatbotId ?? null);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Disconnect: the type wipes its credentials' })
  async disconnect(@Param('id', ParseUUIDPipe) id: string) {
    await this.connectors.disconnect(id);
  }
}
