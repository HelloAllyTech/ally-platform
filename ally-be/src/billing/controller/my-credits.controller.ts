import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { ChatbotCapability } from 'src/chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from 'src/chatbot/service/chatbot-access.service';
import {
  SetBudgetDto,
  TopUpBudgetDto,
  UserLimitsDto,
} from '../dto/credits.dto';
import { LedgerService } from '../service/ledger.service';

/**
 * The builder's credits (stage 6, D1): their own Credits page, and each chatbot's budget panel
 * with its per-user limits. Any signed-in user, for themselves; a chatbot's budget only for its
 * members (reading) or owners (changing), checked like every assistant route (404 to a
 * non-member, 403 without the capability).
 */
@ApiTags('Credits')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('v1/me/credits')
export class MyCreditsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Resolved lazily: billing is global and must not import the chatbot module. */
  private async assertCan(
    chatbotId: string,
    capability: ChatbotCapability,
    userId: number,
  ) {
    const access = this.moduleRef.get(ChatbotAccessService, { strict: false });
    await access.assertCan(chatbotId, capability, userId);
  }

  @ApiOperation({
    summary:
      'Granted, used and remaining free balance, set aside, spend by task kind, chatbot and day, grant history, paused work',
  })
  @Get()
  async mine(@CurrentUser() user: TokenUser) {
    return {
      ...(await this.ledger.creditsFor(user.id)),
      pausedJobs: await this.ledger.pausedForUser(user.id),
    };
  }

  @ApiOperation({ summary: "A chatbot's budget and per-user limits" })
  @Get('chatbots/:chatbotId/budget')
  async budget(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.assertCan(chatbotId, ChatbotCapability.VIEW, user.id);
    return this.ledger.budgetView(chatbotId);
  }

  @ApiOperation({
    summary:
      'Set what is set aside for this chatbot (moves money from the free balance; lowering is clamped at spent)',
  })
  @Put('chatbots/:chatbotId/budget')
  async setBudget(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: SetBudgetDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE, user.id);
    const result = await this.ledger.setBudget(
      chatbotId,
      dto.setAsideUsd,
      user.id,
    );
    return {
      ...(await this.ledger.budgetView(chatbotId)),
      clamped: result.clamped,
      warning: result.warning,
    };
  }

  @ApiOperation({
    summary: "Add to this chatbot's budget from the free balance",
  })
  @Post('chatbots/:chatbotId/budget/top-up')
  async topUp(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: TopUpBudgetDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE, user.id);
    const result = await this.ledger.topUpBudget(
      chatbotId,
      dto.amountUsd,
      user.id,
    );
    return {
      ...(await this.ledger.budgetView(chatbotId)),
      clamped: result.clamped,
      warning: result.warning,
    };
  }

  @ApiOperation({ summary: "This chatbot's per-user dollar limits" })
  @Get('chatbots/:chatbotId/user-limits')
  async userLimits(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.assertCan(chatbotId, ChatbotCapability.VIEW, user.id);
    return (await this.ledger.budgetView(chatbotId)).userLimits;
  }

  @ApiOperation({
    summary:
      "Set this chatbot's per-user daily, weekly and monthly limits (null = none)",
  })
  @Put('chatbots/:chatbotId/user-limits')
  async setUserLimits(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: UserLimitsDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE, user.id);
    return this.ledger.setUserLimits(chatbotId, dto);
  }
}
