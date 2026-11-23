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
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  CreditsCutoverDto,
  GrantCreditsDto,
  TransferBudgetDto,
} from '../dto/credits.dto';
import { CreditsCutoverService } from '../service/credits-cutover.service';
import { LedgerService } from '../service/ledger.service';

/**
 * Ally admin → Credits (stage 6): grant and adjust builders' credits, see every account and its
 * ledger, move a chatbot's budget between accounts, and run the cutover grant. Ally staff with
 * `manage_costs` only (server-checked), like the rest of billing admin. Every grant needs a note
 * and lands in the billing history.
 */
@ApiTags('Credits (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/admin/billing/credits')
export class CreditsAdminController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly cutover: CreditsCutoverService,
  ) {}

  @ApiOperation({ summary: 'Every builder account with its balance' })
  @Get('accounts')
  accounts() {
    return this.ledger.listAccounts();
  }

  @ApiOperation({
    summary: 'One account: balance, budgets, spend and grant history',
  })
  @Get('accounts/:accountId')
  account(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.ledger.accountView(accountId);
  }

  @ApiOperation({
    summary: 'Grant credits, or adjust them (never below spent plus set aside)',
  })
  @Post('grants')
  async grant(@Body() dto: GrantCreditsDto, @CurrentUser() user: TokenUser) {
    const result = await this.ledger.grant(dto, user?.id ?? null);
    return this.ledger.accountView(result.accountId);
  }

  @ApiOperation({ summary: "Move a chatbot's budget to another account" })
  @Post('budgets/:chatbotId/transfer')
  transfer(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: TransferBudgetDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.ledger.transferBudget(
      chatbotId,
      { userId: dto.toUserId, accountId: dto.toAccountId },
      user?.id ?? null,
    );
  }

  @ApiOperation({
    summary:
      'Cutover: starting credits for every builder and a starting budget per live chatbot',
  })
  @Post('cutover')
  runCutover(@Body() dto: CreditsCutoverDto, @CurrentUser() user: TokenUser) {
    return this.cutover.run(dto.dryRun !== false, user?.id ?? null);
  }

  @ApiOperation({
    summary: 'Rebuild every ledger counter from its rows now (the nightly job)',
  })
  @Post('rebuild')
  async rebuild() {
    await this.ledger.rebuild();
    return { rebuilt: true };
  }
}
