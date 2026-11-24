import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PlanViewService } from '../service/plan-view.service';
import { LedgerService } from '../service/ledger.service';

/**
 * The owner's Plan and usage (CR1 Part C): their own plan, tokens left, seats and this month's
 * counts. Any signed-in user, for themselves only. The plan fields carry no prices; stage 6 adds
 * the builder's own credits (dollars they were granted) under `credits`.
 */
@ApiTags('Plan and usage')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('v1/me')
export class MyPlanController {
  constructor(
    private readonly views: PlanViewService,
    private readonly ledger: LedgerService,
  ) {}

  @ApiOperation({
    summary: 'My plan, tokens left, seats and this month’s usage (no prices)',
  })
  @Get('plan')
  async plan(@CurrentUser() user: TokenUser) {
    // Stage 6 (expand): the credits summary is added beside the old plan and seat fields, which
    // stay until the contract release. The full view is GET v1/me/credits.
    const [view, credits] = await Promise.all([
      this.views.forUser(user.id),
      this.ledger.creditsFor(user.id),
    ]);
    return {
      ...view,
      credits: {
        grantedUsd: credits.grantedUsd,
        usedUsd: credits.usedUsd,
        freeBalanceUsd: credits.freeBalanceUsd,
        setAsideUsd: credits.setAsideUsd,
        reserveUsd: credits.reserveUsd,
      },
    };
  }
}
