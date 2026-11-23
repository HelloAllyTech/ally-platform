import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { SpendCapDto, SubscriptionDto } from '../dto/billing-admin.dto';
import { SpendCapService } from '../service/spend-cap.service';
import { PlanService } from '../service/plan.service';
import { PlanViewService } from '../service/plan-view.service';

/**
 * Ally admin → a user → Plan and Spend. Super admins only (`manage_costs`, server-checked).
 * Every change needs a note and lands in the history.
 */
@ApiTags('Billing (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/admin/billing/users/:userId')
export class BillingUsersController {
  constructor(
    private readonly spend: SpendCapService,
    private readonly plans: PlanService,
    private readonly views: PlanViewService,
  ) {}

  @ApiOperation({
    summary:
      "A creator's plan, seats per assistant, this period's counters and history",
  })
  @Get('plan')
  plan(@Param('userId', ParseIntPipe) userId: number) {
    return this.views.forAdmin(userId);
  }

  @ApiOperation({ summary: 'Set the plan and period (chatbot creators only)' })
  @Put('plan')
  setPlan(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SubscriptionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans
      .setPlan(userId, dto as never, user?.id ?? null)
      .then(() => this.views.forAdmin(userId));
  }

  @ApiOperation({
    summary:
      "A creator's spend this period against their cost cap, where it went, and the history",
  })
  @Get('spend')
  spendSummary(@Param('userId', ParseIntPipe) userId: number) {
    return this.spend.summary(userId);
  }

  @ApiOperation({
    summary:
      "Set this creator's own cost cap, go back to the plan's, or never cap them",
  })
  @Put('spend/cap')
  setCap(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SpendCapDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.spend.setCap(userId, dto, user?.id ?? null);
  }
}
