import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
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
import {
  NoteDto,
  SubscriptionDto,
  TokenGrantDto,
  TokenGrantUpdateDto,
  UnlimitedDto,
} from '../dto/billing-admin.dto';
import { TokenService } from '../service/token.service';
import { PlanService } from '../service/plan.service';
import { PlanViewService } from '../service/plan-view.service';

/**
 * Ally admin → a user → Tokens (CR1 Part B). Super admins only (`manage_costs`, server-checked).
 * Every change needs a note and lands in the history.
 */
@ApiTags('Billing (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/admin/billing/users/:userId')
export class BillingUsersController {
  constructor(
    private readonly tokens: TokenService,
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
    summary: "A user's token allowance, grants, history and this month's use",
  })
  @Get('tokens')
  tokenSummary(@Param('userId', ParseIntPipe) userId: number) {
    return this.tokens.summary(userId);
  }

  @ApiOperation({ summary: 'Assign tokens (tops up the balance)' })
  @Post('tokens/grants')
  assign(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: TokenGrantDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.tokens.assign(userId, dto, user?.id ?? null);
  }

  @Patch('tokens/grants/:grantId')
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: TokenGrantUpdateDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.tokens.update(userId, grantId, dto, user?.id ?? null);
  }

  @ApiOperation({ summary: 'Revoke: the unused part is removed from now on' })
  @Post('tokens/grants/:grantId/revoke')
  revoke(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.tokens.revoke(userId, grantId, dto.note, user?.id ?? null);
  }

  @ApiOperation({
    summary: 'Delete an allowance made by mistake (refused once any is used)',
  })
  @Delete('tokens/grants/:grantId')
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.tokens.remove(userId, grantId, dto.note, user?.id ?? null);
  }

  @Put('tokens/unlimited')
  unlimited(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UnlimitedDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.tokens.setUnlimited(
      userId,
      dto.unlimited,
      dto.note,
      user?.id ?? null,
    );
  }
}
