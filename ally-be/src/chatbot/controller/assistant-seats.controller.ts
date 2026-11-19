import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AssignSeatDto } from 'src/billing/dto/billing-admin.dto';
import { PlanService } from 'src/billing/service/plan.service';
import { PlanViewService } from 'src/billing/service/plan-view.service';
import { ChatbotRole } from '../access/chatbot-role.decorator';
import { ChatbotMemberRole } from '../enum/chatbot.enum';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * An assistant's seats, for Share → People (CR1 Part C). Any member sees them; owners assign or
 * move a seat to an invited person, on their own assistants only. Counts, never dollars.
 */
@ApiTags('Assistants')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
export class AssistantSeatsController {
  constructor(
    private readonly plans: PlanService,
    private readonly views: PlanViewService,
  ) {}

  @Get(':id/seats')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Seats, who holds them and this month’s counts' })
  seats(@Param('id', ParseUUIDPipe) id: string) {
    return this.views.forAssistant(id);
  }

  @Get(':id/publish-use')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: '"This uses 1 of your 3 assistants", before publishing',
  })
  publishUse(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.publishUse(id);
  }

  @Put(':id/seats/:seatId/assignee')
  @ChatbotRole(ChatbotMemberRole.OWNER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Give a seat to an invited person, move it, or free it',
  })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: AssignSeatDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.plans.assignSeat(
      id,
      seatId,
      dto.email ?? null,
      user?.id ?? null,
    );
    return this.views.forAssistant(id);
  }
}
