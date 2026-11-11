import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { changes } from '../service/bot-draft-view';
import { BotDraftService } from '../service/bot-draft.service';
import { teamNames } from '../service/team-names';

/** A chatbot's change history, from the draft that built it (20a-2 shows it with Undo). */
@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
export class ChatbotChangesController {
  constructor(
    private readonly drafts: BotDraftService,
    private readonly access: ChatbotAccessService,
  ) {}

  @Get(':id/changes')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  async changes(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id, ChatbotMemberRole.VIEWER);
    const draft = await this.drafts.findByChatbot(id);
    return { changes: draft ? changes(draft.events) : [] };
  }

  @Get(':id/team-names')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  async teamNames(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id, ChatbotMemberRole.VIEWER);
    const draft = await this.drafts.findByChatbot(id);
    // Look and feel's Team photos (chunk 20d): the people onboarding learned about.
    return { names: draft ? teamNames(draft.learned.facts) : [] };
  }
}
